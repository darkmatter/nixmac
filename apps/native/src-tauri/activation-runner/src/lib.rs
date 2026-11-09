//! The privileged helper's post-fork runner: the code that runs between
//! `fork()` and `_exit()` in the child that becomes the detached activation
//! runner.
//!
//! # Why this crate is `no_std`
//!
//! The helper daemon is multithreaded. `fork()` in a multithreaded process
//! copies the whole address space but only the calling thread, so every lock
//! another thread held at that instant — the allocator's included — is frozen
//! locked in the child forever. The child may therefore only make
//! async-signal-safe calls until it exits or execs (the same contract
//! `std::os::unix::process::CommandExt::pre_exec` documents). A single stray
//! allocation here would deadlock intermittently — and a deadlocked
//! runner holds the activation lock forever, wedging every future
//! activation until reboot.
//!
//! `#![no_std]` makes the allocation half of that contract a compile error:
//! this crate cannot reference `std` or `alloc`, only `core` and raw `libc`.
//! Panic-freedom stays manual — nothing below indexes, unwraps, or does
//! arithmetic that can trap.
//!
//! Everything the child needs — validated argv/envp pointer tables, opened
//! file descriptors — is prepared by the parent BEFORE the fork, in ordinary
//! safe Rust, and handed in as [`RunnerPlan`]. The child makes decisions
//! about nothing; it is plumbing from the first syscall to `_exit`.

#![no_std]

use core::ffi::c_char;
use core::ffi::c_int;

/// Everything the post-fork child touches. Built entirely before `fork()`;
/// every pointer must stay valid until the child has exec'd or exited, which
/// the parent guarantees by keeping the owning allocations alive across the
/// fork call.
///
/// All fds must be numerically greater than 3, or the `dup2` chain below
/// could close a source before copying it; the parent enforces that when it
/// opens them.
pub struct RunnerPlan {
    /// Null-terminated argv for the activation command; `argv[0]` is the
    /// absolute program path.
    pub activate_argv: *const *const c_char,
    /// Null-terminated envp for the activation command.
    pub activate_envp: *const *const c_char,
    /// Null-terminated argv for the post-activation profile update
    /// (`nix-env --set`), or null when the parent found no usable `nix-env`
    /// (the failure warning is written instead).
    pub profile_argv: *const *const c_char,
    /// Null-terminated envp for the profile update.
    pub profile_envp: *const *const c_char,
    /// Pre-formatted warning line (newline included) written to the log when
    /// the profile update fails or is unavailable. Pre-formatted because the
    /// child must not format anything.
    pub profile_warning: *const u8,
    pub profile_warning_len: usize,
    /// Read end for stdin: /dev/null.
    pub devnull_fd: c_int,
    /// The activation log; becomes the child's stdout and stderr.
    pub log_fd: c_int,
    /// The exclusive activation lock. Held by this process for exactly its
    /// lifetime; never inherited by the activation command (CLOEXEC is set
    /// after the dup2 chain).
    pub lock_fd: c_int,
    /// One past the highest fd to close; the parent captures
    /// `getdtablesize()` before forking.
    pub fd_limit: c_int,
}

/// The fixed fd the lock is parked on inside the runner, chosen so the
/// close-everything loop below has a stable set to preserve.
const LOCK_FD: c_int = 3;

/// Runs the activation as the detached runner. Must be called in a freshly
/// forked child
/// and nowhere else; the caller passes the returned code straight to
/// `libc::_exit`.
///
/// Exit code: the activation's own exit code; `128 + signal` when it was
/// killed by a signal; 127 when it could not be spawned at all.
///
/// # Safety
///
/// - Must run in a forked child of the process that built `plan`, before
///   anything else touched the child.
/// - Every pointer in `plan` must be valid and null-terminated as documented.
/// - All three fds must be open and greater than 3.
pub unsafe fn run(plan: &RunnerPlan) -> c_int {
    unsafe {
        // Own session: outside the daemon's process group, so launchd's
        // group sweep at unregister (already disabled via
        // AbandonProcessGroup) cannot touch this process either way.
        libc::setsid();

        // Inherited signal mask reset, so a mask a helper thread happened to
        // hold cannot silently block the child's SIGCHLD handling.
        let mut empty: libc::sigset_t = core::mem::zeroed();
        libc::sigemptyset(&mut empty);
        libc::sigprocmask(libc::SIG_SETMASK, &empty, core::ptr::null_mut());

        // The Rust runtime sets SIGPIPE to SIG_IGN at process start, and an
        // ignored disposition survives both fork and execve. Left in place,
        // every pipeline inside the activation script would see EPIPE write
        // errors instead of ordinary pipe termination — a divergence from
        // both the shell's expectations and the password path's executor
        // (std::process::Command resets it; the raw execve below does not).
        libc::signal(libc::SIGPIPE, libc::SIG_DFL);
        // SIGCHLD likewise: an inherited SIG_IGN would auto-reap the
        // children and make `waitpid` below fail with ECHILD, losing the
        // activation's real exit code — 127 reported, the profile update
        // skipped after a success. No daemon code sets it today; this
        // makes that future regression impossible rather than documented.
        libc::signal(libc::SIGCHLD, libc::SIG_DFL);

        libc::dup2(plan.devnull_fd, 0);
        libc::dup2(plan.log_fd, 1);
        libc::dup2(plan.log_fd, 2);
        libc::dup2(plan.lock_fd, LOCK_FD);

        // The forked image holds copies of every fd the helper had open —
        // the listening socket and accepted connections included. An orphan
        // keeping the listener open would make client connects succeed with
        // nobody answering for the whole activation; close everything that
        // is not the four just placed.
        let mut fd = LOCK_FD + 1;
        while fd < plan.fd_limit {
            libc::close(fd);
            fd += 1;
        }

        // The lock must die at the activation command's exec: a straggler
        // the activate script leaves behind must not hold the slot forever.
        // This process itself keeps it for exactly its lifetime.
        libc::fcntl(LOCK_FD, libc::F_SETFD, libc::FD_CLOEXEC);

        let code = run_and_wait(plan.activate_argv, plan.activate_envp);
        if code == 0 {
            let profile_ok = !plan.profile_argv.is_null()
                && run_and_wait(plan.profile_argv, plan.profile_envp) == 0;
            if !profile_ok {
                // Best-effort marker; the profile command's own output went
                // to the log through fds 1/2. The system switch already
                // happened, so this is a warning, never a failure.
                libc::write(1, plan.profile_warning.cast(), plan.profile_warning_len);
            }
        }
        code
    }
}

/// The raw errno read, named per platform: Darwin exposes `__error`, Linux
/// (where CI compiles this crate) `__errno_location`. Both are a pure
/// thread-local pointer read — async-signal-safe.
#[cfg(target_os = "macos")]
unsafe fn errno() -> c_int {
    unsafe { *libc::__error() }
}

#[cfg(not(target_os = "macos"))]
unsafe fn errno() -> c_int {
    unsafe { *libc::__errno_location() }
}

/// Forks and execs one prepared command, waits for it, and folds its status
/// into an exit code. Async-signal-safe calls only — not literally bare
/// syscalls: macOS's `fork` runs the process's `pthread_atfork` handlers.
unsafe fn run_and_wait(argv: *const *const c_char, envp: *const *const c_char) -> c_int {
    unsafe {
        match libc::fork() {
            -1 => 127,
            0 => {
                libc::execve(argv.read(), argv, envp);
                // Exec failed; nothing to clean up and nothing safe to
                // report beyond the code.
                libc::_exit(127);
            }
            pid => {
                let mut status: c_int = 0;
                loop {
                    let waited = libc::waitpid(pid, &mut status, 0);
                    if waited == pid {
                        break;
                    }
                    if waited == -1 && errno() != libc::EINTR {
                        return 127;
                    }
                }
                if libc::WIFEXITED(status) {
                    libc::WEXITSTATUS(status)
                } else if libc::WIFSIGNALED(status) {
                    128 + libc::WTERMSIG(status)
                } else {
                    127
                }
            }
        }
    }
}
