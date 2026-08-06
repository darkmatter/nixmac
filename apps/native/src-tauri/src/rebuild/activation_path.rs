// Which of the two activation paths one apply may use.
//
// There are exactly two ways nixmac activates a built generation: it asks the
// privileged helper, or it prompts for an administrator password. This module
// decides which, and its whole purpose is that the decision is made *before*
// any bytes reach the helper, from reconciled service state — and that nothing
// a helper exchange returns afterwards can select the password path. A refusal
// is reported; it is never quietly substituted with a password prompt.
//
// Two things carry that, and they are types rather than discipline:
//
//   * [`Route`] comes from `route`, a total match over the stored decision and
//     all four registration statuses. A status the platform can report has
//     nowhere to hide, and only one pairing dispatches.
//   * The password path exists only as [`ApplyEnvironment::password_activate`],
//     which records that a password activation is running for as long as it
//     runs. No seam prompts without recording, so a helper cannot be registered
//     underneath a prompt this process started.

use crate::privileged_helper::client::HelperClientError;
use crate::privileged_helper::protocol::{ActivationInfo, HelperReply};
use crate::privileged_helper::service::RegistrationStatus;
use crate::privileged_helper::socket_probe::ListenerObservation;
use crate::rebuild::darwin::ActivateResult;
use crate::shared_types::HelperPreference;

/// Everything one apply observes or does about the two paths, injected so every
/// row below can be driven without a helper, a bundle, or a settings store.
///
/// Observations and effects only — no method here decides which path an apply
/// takes. The one method that answers anything is `password_activate`, which
/// refuses while a replacement holds the slot, and that is not a choice between
/// paths: it is the record and the prompt being inseparable (see above).
pub trait ApplyEnvironment {
    /// The stored decision about the helper, read as-is: only the replacement
    /// function ever resolves "undecided".
    fn preference(&self) -> Result<HelperPreference, String>;

    /// The sentence to carry when this copy of nixmac may not touch a helper at
    /// all — it runs from outside `/Applications`, or its bundle was replaced
    /// underneath it. `None` when it may.
    fn displacement(&self) -> Option<String>;

    /// What `SMAppService` reports about nixmac's helper registration.
    fn registration_status(&self) -> Result<RegistrationStatus, String>;

    /// Sends `TryActivate` and waits for its result. An activation legitimately
    /// runs for many minutes, so an implementation must not leash this wait to
    /// the short deadlines the other exchanges use; the live one bounds it only
    /// at `client::ACTIVATION_TIMEOUT`, past which the outcome is unknown.
    fn dispatch_activation(&self, activate_path: &str) -> Result<HelperReply, DispatchFailure>;

    /// Whether anything is listening on the helper socket, over the full
    /// absence window. Pure observation, and the only thing that can establish
    /// that an `enabled` registration has no process behind it.
    fn observe_listener(&self) -> ListenerObservation;

    /// Runs the administrator-password activation, recording for as long as it
    /// runs that one is running.
    ///
    /// Bundled deliberately: a caller cannot prompt without the record, so the
    /// replacement function's register step can never land underneath a
    /// password activation this process started.
    fn password_activate(&self, activate_path: &str) -> PasswordActivation;
}

/// Why a dispatch produced no reply.
pub enum DispatchFailure {
    /// The exchange with the helper.
    Exchange(HelperClientError),
    /// The request could not even be assembled, because the activation path is
    /// not one the helper accepts. Nothing was dispatched, and no other path is
    /// tried: that is an error about this apply, not about the helper.
    Unusable(anyhow::Error),
}

/// What the password path did, or why it did not run.
pub enum PasswordActivation {
    /// The prompt ran; this is its outcome.
    Ran(Result<ActivateResult, anyhow::Error>),
    /// A helper replacement holds the reconciliation slot, so nothing was
    /// started. Between an unregister and the register that follows it,
    /// `SMAppService` transiently reports `notRegistered` — which the table
    /// below would otherwise read as "no helper, the password path is safe".
    HelperBeingReplaced,
}

/// Activates `activate_path` by whichever path is allowed, or reports that
/// neither is.
///
/// A refusal comes back as a failed [`ActivateResult`] carrying the report — the
/// same shape a failed activation has, which every consumer already renders.
pub fn activate<E: ApplyEnvironment>(
    env: &E,
    activate_path: &str,
) -> Result<ActivateResult, anyhow::Error> {
    let helper = helper_use(env.preference(), env.displacement());
    match route(&helper, env.registration_status()) {
        Route::Dispatch => dispatch(env, activate_path, &helper),
        Route::Password => password(env, activate_path, &helper),
        Route::Refuse(reason) => Ok(refused(reason, &helper)),
    }
}

/// Whether this apply may use a helper at all.
#[derive(Debug, Clone, PartialEq, Eq)]
enum HelperUse {
    /// The stored decision is `granted`, and this copy may touch a helper.
    Permitted,
    /// It may not. `note` is the extra sentence its refusals carry: move the
    /// app, restart the app, or why the stored decision could not be read.
    Withheld { note: Option<String> },
}

/// Folds the stored decision and the two displacement gates into the one
/// question the table asks.
///
/// Every failure lands on `Withheld`, and `Withheld` is not the password path:
/// it still refuses while a registration is enabled. So neither an unreadable
/// decision nor a displaced copy can talk nixmac into password-activating
/// underneath a helper.
fn helper_use(
    preference: Result<HelperPreference, String>,
    displacement: Option<String>,
) -> HelperUse {
    // A copy running from outside `/Applications`, or one whose bundle was
    // replaced while it ran, touches no helper whatever the decision says.
    if let Some(note) = displacement {
        return HelperUse::Withheld { note: Some(note) };
    }
    match preference {
        Ok(HelperPreference::Granted) => HelperUse::Permitted,
        // Undecided or disabled: an existing registration is the replacement
        // function's to adopt or remove, not this apply's to use.
        Ok(HelperPreference::Unset | HelperPreference::Disabled) => {
            HelperUse::Withheld { note: None }
        }
        Err(detail) => HelperUse::Withheld {
            note: Some(format!(
                "The stored helper decision could not be read: {detail}."
            )),
        },
    }
}

/// Which path this apply takes, decided before any helper exchange.
#[derive(Debug, PartialEq, Eq)]
enum Route {
    /// Send `TryActivate`. The helper decides admission atomically, and no
    /// probe result gates this dispatch.
    Dispatch,
    /// The administrator-password path: nixmac knows no helper activation is
    /// running or was dispatched.
    Password,
    /// Neither path. Reported, never silently substituted.
    Refuse(Reason),
}

/// Why an apply refuses — one variant per case the contract names, so a missing
/// row would be a missing variant rather than a silent password prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Reason {
    /// A registration is enabled that this apply may not use. It could still
    /// admit a scheduled sync-agent activation, so nixmac does not
    /// password-activate underneath it; the replacement function adopts or
    /// removes it first.
    HelperStillInstalled,
    /// `SMAppService` could not be read, so nothing proves the helper quiet.
    RegistrationUnreadable(String),
    /// The helper is being replaced right now.
    HelperBeingReplaced,
    /// Something holds the helper socket that could not be identified: a
    /// validation that reached no judgment, or a peer that is not root.
    PeerUnidentified(String),
    /// The socket could not be used and its absence could not be proven either.
    SocketUnusable(String),
    /// The installed helper cannot run this build's activation — a build
    /// mismatch, or a helper too old to parse this build's request body. Both
    /// mean the same thing: it must be replaced or disabled first.
    HelperUpdateRequired(String),
    /// An activation is already running, and X says whose.
    ActivationRunning(ActivationInfo),
    /// An authenticated helper answered something that is not an activation
    /// result.
    HelperRefused(String),
    /// The request was dispatched and the outcome is not known.
    UnknownOutcome(String),
}

impl std::fmt::Display for Reason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::HelperStillInstalled => f.write_str(
                "The unattended sync helper is still installed but is not enabled for this app, so nixmac did not activate and did not fall back to the administrator-password prompt. Enable or disable the helper, then apply again.",
            ),
            Self::RegistrationUnreadable(detail) => write!(
                f,
                "The unattended sync helper's registration could not be read ({detail}), so nixmac did not activate."
            ),
            Self::HelperBeingReplaced => f.write_str(
                "The unattended sync helper is being replaced, so nixmac did not activate. Apply again once that has finished.",
            ),
            Self::PeerUnidentified(detail) => write!(
                f,
                "The process answering the helper socket could not be identified ({detail}), so nixmac did not activate and did not fall back to the administrator-password prompt."
            ),
            Self::SocketUnusable(detail) => write!(
                f,
                "The helper socket could not be used and its absence could not be established either ({detail}), so nixmac did not activate."
            ),
            Self::HelperUpdateRequired(detail) => write!(
                f,
                "The installed unattended sync helper cannot run this build's activation: {detail}. nixmac replaces it the next time it reads the helper — opening Settings → Permissions does that now, and so does relaunching nixmac; apply again after that."
            ),
            Self::ActivationRunning(activation) => write!(
                f,
                "An activation is already running ({} submitted by the {}), so nixmac did not start another.",
                activation.script_path, activation.client_kind
            ),
            Self::HelperRefused(detail) => write!(
                f,
                "The unattended sync helper did not start the activation: {detail}. nixmac did not fall back to the administrator-password prompt."
            ),
            Self::UnknownOutcome(detail) => write!(
                f,
                "The unattended sync helper did not return a trustworthy result: {detail}. The activation may have completed or may still be running; nixmac did not fall back to the administrator-password prompt."
            ),
        }
    }
}

/// The table. Total over the stored decision and all four statuses.
fn route(helper: &HelperUse, status: Result<RegistrationStatus, String>) -> Route {
    let status = match status {
        Ok(status) => status,
        Err(detail) => return Route::Refuse(Reason::RegistrationUnreadable(detail)),
    };
    match (helper, status) {
        // Granted, and a registration is enabled: dispatch and let the helper
        // decide admission.
        (HelperUse::Permitted, RegistrationStatus::Enabled) => Route::Dispatch,
        // Enabled, but not this apply's to use. Refusing is what keeps nixmac
        // from password-activating while that registration could still admit a
        // scheduled sync-agent activation.
        (HelperUse::Withheld { .. }, RegistrationStatus::Enabled) => {
            Route::Refuse(Reason::HelperStillInstalled)
        }
        // Proven quiet: nothing registered, a registration pending approval
        // (which has no process), or a service definition that is not there.
        (
            _,
            RegistrationStatus::NotRegistered
            | RegistrationStatus::RequiresApproval
            | RegistrationStatus::NotFound,
        ) => Route::Password,
    }
}

/// Dispatches the activation and reads what came back.
///
/// Only an activation result is an activation. Every other reply and every
/// failure is a refusal — with one exception that is not one: a connection that
/// was never established wrote no request bytes, so nothing was dispatched, and
/// the absence it may prove is still a pre-dispatch observation.
fn dispatch<E: ApplyEnvironment>(
    env: &E,
    activate_path: &str,
    helper: &HelperUse,
) -> Result<ActivateResult, anyhow::Error> {
    match env.dispatch_activation(activate_path) {
        // The activation ran in the helper. Its own success or failure is the
        // apply's, and this is the only way to learn it.
        Ok(HelperReply::ActivationResult(result)) => Ok(ActivateResult {
            success: result.ok,
            code: result.code,
            stdout: result.stdout,
            // The result has no stderr: the activation log arrives merged into
            // stdout, so only a helper-level error belongs in the stderr slot
            // consumers show for failures.
            stderr: result.error.unwrap_or_default(),
        }),
        Ok(reply) => Ok(refused(reply_refusal(reply), helper)),
        // Not a refusal and not an outcome: the apply itself cannot be
        // expressed, so it fails rather than looking for another path.
        Err(DispatchFailure::Unusable(error)) => Err(error),
        Err(DispatchFailure::Exchange(error)) => match exchange_failure(error) {
            ExchangeFailure::Refused(reason) => Ok(refused(reason, helper)),
            // Nothing was dispatched. Whether the socket has no process at all —
            // the one remaining observation that proves quiet — takes the full
            // absence window to establish.
            ExchangeFailure::NeverConnected(connect_error) => match env.observe_listener() {
                ListenerObservation::PositivelyAbsent => password(env, activate_path, helper),
                ListenerObservation::Listening => Ok(refused(
                    Reason::SocketUnusable(format!(
                        "{connect_error}; something is listening on it but did not answer"
                    )),
                    helper,
                )),
                ListenerObservation::Ambiguous(detail) => Ok(refused(
                    Reason::SocketUnusable(format!("{connect_error}; {detail}")),
                    helper,
                )),
            },
        },
    }
}

/// What one failed exchange means for this apply.
#[derive(Debug, PartialEq, Eq)]
enum ExchangeFailure {
    /// No connection was established, so no request bytes were written and
    /// nothing was dispatched.
    NeverConnected(String),
    /// Everything else. Report it — an exchange that was attempted can never
    /// select the password path, whether or not it proved anything.
    Refused(Reason),
}

/// Reads one exchange failure. Total over the client's error set.
fn exchange_failure(error: HelperClientError) -> ExchangeFailure {
    match error {
        HelperClientError::Unreachable(ref connect_error) => {
            ExchangeFailure::NeverConnected(connect_error.to_string())
        }
        // Nothing was written to this peer either, but an unidentified process
        // holding the helper socket is exactly what makes "no activation is
        // running" impossible to establish.
        HelperClientError::AuthenticationFailed(ref failure) => {
            ExchangeFailure::Refused(Reason::PeerUnidentified(format!("{failure:#}")))
        }
        // Past the request write, nothing can prove the helper did not run it —
        // a close, an I/O failure mid-exchange, and a reply this build cannot
        // read are all unknown outcomes.
        HelperClientError::ClosedBeforeReply
        | HelperClientError::Io(_)
        | HelperClientError::UnparseableReply(_) => {
            ExchangeFailure::Refused(Reason::UnknownOutcome(error.to_string()))
        }
    }
}

/// Reads one reply that is not an activation result.
fn reply_refusal(reply: HelperReply) -> Reason {
    match reply {
        HelperReply::Busy { activation } => Reason::ActivationRunning(activation),
        // This helper will never start this activation: it is retiring or
        // already retired, so it is on its way out.
        HelperReply::Retired { .. } => Reason::HelperBeingReplaced,
        // One thing to a client: the installed helper cannot run this build's
        // activation. There is deliberately no promise about which of the two an
        // older helper answers with.
        HelperReply::BuildMismatch { .. } | HelperReply::RequestNotUnderstood => {
            Reason::HelperUpdateRequired(reply.summary())
        }
        other => Reason::HelperRefused(other.summary()),
    }
}

fn password<E: ApplyEnvironment>(
    env: &E,
    activate_path: &str,
    helper: &HelperUse,
) -> Result<ActivateResult, anyhow::Error> {
    match env.password_activate(activate_path) {
        PasswordActivation::Ran(outcome) => outcome,
        PasswordActivation::HelperBeingReplaced => Ok(refused(Reason::HelperBeingReplaced, helper)),
    }
}

/// One refusal, as the failed result every consumer already renders.
fn refused(reason: Reason, helper: &HelperUse) -> ActivateResult {
    let mut report = reason.to_string();
    // A displaced copy's refusals carry what the user should do about it.
    if let HelperUse::Withheld { note: Some(note) } = helper {
        report.push(' ');
        report.push_str(note);
    }
    ActivateResult {
        success: false,
        code: -1,
        stdout: String::new(),
        stderr: report,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::privileged_helper::peer_auth::ClientKind;
    use crate::privileged_helper::protocol::ActivationResult;
    use std::cell::RefCell;

    const ACTIVATE_PATH: &str = "/nix/store/abc-darwin-system/activate";

    /// What one apply is allowed to do, and what it did.
    struct World {
        preference: Result<HelperPreference, String>,
        displacement: Option<String>,
        status: Result<RegistrationStatus, String>,
        /// What `TryActivate` comes back with, when it is sent at all.
        dispatch: RefCell<Option<Result<HelperReply, HelperClientError>>>,
        /// The activation body cannot be assembled from the path at all.
        unusable: bool,
        listener: ListenerObservation,
        /// Whether a replacement holds the slot when the prompt is reached.
        replacement_in_flight: bool,
        acts: RefCell<Vec<Act>>,
    }

    /// The three things that can actually happen, in order. Every "never the
    /// password path" assertion is about this sequence.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum Act {
        Dispatched,
        Probed,
        Prompted,
    }

    impl Default for World {
        fn default() -> Self {
            Self {
                preference: Ok(HelperPreference::Granted),
                displacement: None,
                status: Ok(RegistrationStatus::Enabled),
                dispatch: RefCell::new(None),
                unusable: false,
                listener: ListenerObservation::PositivelyAbsent,
                replacement_in_flight: false,
                acts: RefCell::new(Vec::new()),
            }
        }
    }

    impl World {
        /// Granted, enabled, and the helper answers `reply`.
        fn answering(reply: HelperReply) -> Self {
            Self {
                dispatch: RefCell::new(Some(Ok(reply))),
                ..Self::default()
            }
        }

        /// Granted, enabled, and the exchange fails.
        fn failing(error: HelperClientError) -> Self {
            Self {
                dispatch: RefCell::new(Some(Err(error))),
                ..Self::default()
            }
        }

        fn acts(&self) -> Vec<Act> {
            self.acts.borrow().clone()
        }

        fn did(&self, act: Act) {
            self.acts.borrow_mut().push(act);
        }
    }

    impl ApplyEnvironment for World {
        fn preference(&self) -> Result<HelperPreference, String> {
            self.preference.clone()
        }

        fn displacement(&self) -> Option<String> {
            self.displacement.clone()
        }

        fn registration_status(&self) -> Result<RegistrationStatus, String> {
            self.status.clone()
        }

        fn dispatch_activation(&self, activate_path: &str) -> Result<HelperReply, DispatchFailure> {
            assert_eq!(activate_path, ACTIVATE_PATH);
            self.did(Act::Dispatched);
            if self.unusable {
                return Err(DispatchFailure::Unusable(anyhow::anyhow!(
                    "not a store activation path"
                )));
            }
            self.dispatch
                .borrow_mut()
                .take()
                .expect("one dispatch, and only where the table dispatches")
                .map_err(DispatchFailure::Exchange)
        }

        fn observe_listener(&self) -> ListenerObservation {
            self.did(Act::Probed);
            self.listener.clone()
        }

        fn password_activate(&self, activate_path: &str) -> PasswordActivation {
            assert_eq!(activate_path, ACTIVATE_PATH);
            if self.replacement_in_flight {
                // The record and the refusal are one step in the real
                // implementation, which is why nothing is recorded here.
                return PasswordActivation::HelperBeingReplaced;
            }
            self.did(Act::Prompted);
            PasswordActivation::Ran(Ok(ActivateResult {
                success: true,
                code: 0,
                stdout: "activated with an administrator password".to_string(),
                stderr: String::new(),
            }))
        }
    }

    fn activation() -> ActivationInfo {
        ActivationInfo {
            request_id: "request-1".to_string(),
            script_path: ACTIVATE_PATH.to_string(),
            client_kind: ClientKind::SyncAgent,
        }
    }

    fn apply(world: &World) -> ActivateResult {
        activate(world, ACTIVATE_PATH).expect("the fake password path cannot fail to run")
    }

    /// Refused: nothing activated, and — the part that matters — no prompt.
    fn assert_refused(world: &World, result: &ActivateResult) {
        assert!(!result.success, "a refusal is not a successful activation");
        assert_eq!(result.code, -1);
        assert!(
            !world.acts().contains(&Act::Prompted),
            "a refusal must never fall back to the administrator-password prompt: {}",
            result.stderr
        );
    }

    // ── the table ──────────────────────────────────────────────────────────

    #[test]
    fn granted_and_enabled_is_the_only_pairing_that_dispatches() {
        assert_eq!(
            route(&HelperUse::Permitted, Ok(RegistrationStatus::Enabled)),
            Route::Dispatch
        );
    }

    #[test]
    fn every_proven_quiet_observation_takes_the_password_path() {
        // The closed set of eligibility observations: nothing registered, a
        // registration pending approval (which has no process), and a broken
        // service definition. Under either column — the password path itself
        // needs no grant.
        for helper in [
            HelperUse::Permitted,
            HelperUse::Withheld { note: None },
            HelperUse::Withheld {
                note: Some("move it".to_string()),
            },
        ] {
            for status in [
                RegistrationStatus::NotRegistered,
                RegistrationStatus::RequiresApproval,
                RegistrationStatus::NotFound,
            ] {
                assert_eq!(route(&helper, Ok(status)), Route::Password, "{status}");
            }
        }
    }

    #[test]
    fn an_enabled_registration_this_apply_may_not_use_refuses_instead() {
        // Never the password path: that registration could still admit a
        // scheduled sync-agent activation, and nixmac does not activate
        // underneath one.
        for note in [None, Some("restart nixmac".to_string())] {
            assert_eq!(
                route(
                    &HelperUse::Withheld { note },
                    Ok(RegistrationStatus::Enabled)
                ),
                Route::Refuse(Reason::HelperStillInstalled)
            );
        }
    }

    #[test]
    fn an_unreadable_registration_refuses_rather_than_guessing_quiet() {
        assert_eq!(
            route(&HelperUse::Permitted, Err("no service".to_string())),
            Route::Refuse(Reason::RegistrationUnreadable("no service".to_string()))
        );
    }

    #[test]
    fn nothing_about_managed_app_bundles_can_divert_a_granted_helper_apply() {
        // The decision's inputs are the stored decision, the displacement gates
        // and the registration status — a closed set. An apply that touches
        // managed app bundles (App Management) therefore dispatches through the
        // helper like any other: skipping the helper for those was a silent
        // password-path substitution, and the preflight already refuses the
        // apply outright when the permission is missing.
        let world = World::answering(HelperReply::ActivationResult(ActivationResult {
            ok: true,
            code: 0,
            stdout: "activated".to_string(),
            error: None,
        }));

        let result = apply(&world);

        assert!(result.success);
        assert_eq!(world.acts(), vec![Act::Dispatched]);
    }

    // ── what a copy that may not touch a helper does ───────────────────────

    #[test]
    fn a_displaced_copy_is_withheld_whatever_the_stored_decision_says() {
        for preference in [
            Ok(HelperPreference::Granted),
            Ok(HelperPreference::Unset),
            Ok(HelperPreference::Disabled),
            Err("unreadable".to_string()),
        ] {
            assert_eq!(
                helper_use(preference, Some("move it to /Applications".to_string())),
                HelperUse::Withheld {
                    note: Some("move it to /Applications".to_string())
                }
            );
        }
    }

    #[test]
    fn only_a_granted_decision_permits_a_helper() {
        assert_eq!(
            helper_use(Ok(HelperPreference::Granted), None),
            HelperUse::Permitted
        );
        for preference in [HelperPreference::Unset, HelperPreference::Disabled] {
            assert_eq!(
                helper_use(Ok(preference), None),
                HelperUse::Withheld { note: None }
            );
        }
    }

    #[test]
    fn an_unreadable_decision_is_withheld_and_says_so() {
        let HelperUse::Withheld { note: Some(note) } =
            helper_use(Err("store missing".to_string()), None)
        else {
            panic!("an unreadable decision must not permit a helper");
        };
        assert!(note.contains("store missing"));
    }

    #[test]
    fn a_displaced_copy_carries_its_guidance_into_the_refusal() {
        let world = World {
            displacement: Some("Move nixmac to /Applications.".to_string()),
            ..World::default()
        };

        let result = apply(&world);

        assert_refused(&world, &result);
        assert!(result.stderr.contains("Move nixmac to /Applications."));
        assert!(
            world.acts().is_empty(),
            "a displaced copy touches no helper at all"
        );
    }

    #[test]
    fn a_displaced_copy_still_uses_the_password_path_when_nothing_is_registered() {
        // The password path itself requires no canonical install.
        let world = World {
            displacement: Some("Move nixmac to /Applications.".to_string()),
            status: Ok(RegistrationStatus::NotRegistered),
            ..World::default()
        };

        let result = apply(&world);

        assert!(result.success);
        assert_eq!(world.acts(), vec![Act::Prompted]);
    }

    // ── what came back from a dispatch ─────────────────────────────────────

    #[test]
    fn an_activation_result_is_the_applys_own_result() {
        for (ok, code, error) in [
            (true, 0, None),
            (false, 1, Some("activation script failed".to_string())),
        ] {
            let world = World::answering(HelperReply::ActivationResult(ActivationResult {
                ok,
                code,
                stdout: "log".to_string(),
                error: error.clone(),
            }));

            let result = apply(&world);

            assert_eq!(result.success, ok);
            assert_eq!(result.code, code);
            assert_eq!(result.stdout, "log");
            assert_eq!(result.stderr, error.unwrap_or_default());
            assert_eq!(world.acts(), vec![Act::Dispatched]);
        }
    }

    #[test]
    fn every_reply_that_is_not_a_result_refuses() {
        // The complete reply set, minus the activation result above. None of
        // them is permission to activate some other way.
        let replies = [
            (
                HelperReply::Busy {
                    activation: activation(),
                },
                Reason::ActivationRunning(activation()),
            ),
            (
                HelperReply::Retired { activation: None },
                Reason::HelperBeingReplaced,
            ),
            (
                HelperReply::Retired {
                    activation: Some(activation()),
                },
                Reason::HelperBeingReplaced,
            ),
            (
                HelperReply::BuildMismatch {
                    helper_build_id: "build-previous".to_string(),
                },
                Reason::HelperUpdateRequired(
                    "the installed helper is from a different nixmac build (build build-previous)"
                        .to_string(),
                ),
            ),
            (
                HelperReply::RequestNotUnderstood,
                Reason::HelperUpdateRequired(HelperReply::RequestNotUnderstood.summary()),
            ),
            (
                HelperReply::CallerNotPermitted,
                Reason::HelperRefused(HelperReply::CallerNotPermitted.summary()),
            ),
            (
                HelperReply::Status {
                    state: crate::privileged_helper::protocol::HelperStateName::Idle,
                    helper_build_id: "build-current".to_string(),
                    activation: None,
                },
                Reason::HelperRefused(
                    HelperReply::Status {
                        state: crate::privileged_helper::protocol::HelperStateName::Idle,
                        helper_build_id: "build-current".to_string(),
                        activation: None,
                    }
                    .summary(),
                ),
            ),
        ];

        for (reply, expected) in replies {
            assert_eq!(reply_refusal(reply.clone()), expected, "{reply:?}");

            let world = World::answering(reply);
            let result = apply(&world);

            assert_refused(&world, &result);
            assert_eq!(world.acts(), vec![Act::Dispatched]);
        }
    }

    #[test]
    fn a_build_mismatch_reports_the_helper_build_it_found() {
        let world = World::answering(HelperReply::BuildMismatch {
            helper_build_id: "build-previous".to_string(),
        });

        let result = apply(&world);

        assert_refused(&world, &result);
        assert!(result.stderr.contains("build-previous"));
    }

    #[test]
    fn a_running_activation_is_reported_with_the_script_and_the_client_that_submitted_it() {
        let world = World::answering(HelperReply::Busy {
            activation: activation(),
        });

        let result = apply(&world);

        assert_refused(&world, &result);
        assert!(result.stderr.contains(ACTIVATE_PATH));
        assert!(result.stderr.contains("sync agent"));
    }

    // ── what a failed exchange means ───────────────────────────────────────

    #[test]
    fn only_a_connection_that_was_never_established_dispatched_nothing() {
        assert_eq!(
            exchange_failure(HelperClientError::Unreachable(std::io::Error::from(
                std::io::ErrorKind::ConnectionRefused
            ))),
            ExchangeFailure::NeverConnected(
                std::io::Error::from(std::io::ErrorKind::ConnectionRefused).to_string()
            )
        );
    }

    #[test]
    fn every_other_exchange_failure_is_reported_and_never_falls_back() {
        // An authentication failure is the one that most invites a fallback: it
        // is where an unsigned local build lands. Under the contract it is a
        // refusal — something unidentified holds the socket, so nixmac cannot
        // establish that no activation is running.
        // Built twice rather than cloned: a client error carries an
        // `anyhow::Error` and an `io::Error`, neither of which clones.
        let failures: [fn() -> HelperClientError; 4] = [
            || HelperClientError::AuthenticationFailed(anyhow::anyhow!("unsigned")),
            || HelperClientError::ClosedBeforeReply,
            || HelperClientError::Io(std::io::Error::from(std::io::ErrorKind::TimedOut)),
            || HelperClientError::UnparseableReply("not json".to_string()),
        ];
        for failure in failures {
            assert!(
                matches!(exchange_failure(failure()), ExchangeFailure::Refused(_)),
                "{}",
                failure()
            );

            let world = World::failing(failure());
            let result = apply(&world);

            assert_refused(&world, &result);
            assert_eq!(
                world.acts(),
                vec![Act::Dispatched],
                "an attempted exchange is never followed by an absence probe"
            );
        }
    }

    #[test]
    fn a_socket_with_no_listener_at_all_takes_the_password_path() {
        // Positive absence is the fourth eligibility observation, and nothing
        // was dispatched: the connection was never established.
        let world = World::failing(HelperClientError::Unreachable(std::io::Error::from(
            std::io::ErrorKind::ConnectionRefused,
        )));

        let result = apply(&world);

        assert!(result.success);
        assert_eq!(
            world.acts(),
            vec![Act::Dispatched, Act::Probed, Act::Prompted]
        );
    }

    #[test]
    fn an_absence_that_could_not_be_established_refuses() {
        for listener in [
            ListenerObservation::Listening,
            ListenerObservation::Ambiguous("timed out".to_string()),
        ] {
            let world = World {
                listener,
                dispatch: RefCell::new(Some(Err(HelperClientError::Unreachable(
                    std::io::Error::from(std::io::ErrorKind::ConnectionRefused),
                )))),
                ..World::default()
            };

            let result = apply(&world);

            assert_refused(&world, &result);
            assert_eq!(world.acts(), vec![Act::Dispatched, Act::Probed]);
        }
    }

    #[test]
    fn an_activation_body_that_cannot_be_assembled_fails_the_apply() {
        // Not a refusal and not an outcome: the apply itself cannot be
        // expressed, so it fails rather than looking for another path.
        let world = World {
            unusable: true,
            ..World::default()
        };

        let error = activate(&world, ACTIVATE_PATH).expect_err("an unusable path cannot activate");

        assert!(error.to_string().contains("store activation path"));
        assert_eq!(world.acts(), vec![Act::Dispatched]);
    }

    // ── the race with the replacement function ─────────────────────────────

    #[test]
    fn an_apply_during_a_replacement_refuses_rather_than_reading_the_gap_as_quiet() {
        // Between the replacement's unregister and its register, `SMAppService`
        // transiently reports `notRegistered`. Reading that as "no helper, the
        // password path is safe" is exactly what the shared record prevents:
        // the prompt and the record are one step, and it refuses.
        let world = World {
            status: Ok(RegistrationStatus::NotRegistered),
            replacement_in_flight: true,
            ..World::default()
        };

        let result = apply(&world);

        assert_refused(&world, &result);
        assert!(result.stderr.contains("being replaced"));
        assert!(world.acts().is_empty());
    }

    #[test]
    fn an_apply_that_dispatches_into_a_replacement_is_refused_by_the_helper_itself() {
        // The dispatch branch of the same race. A replacement that has retired
        // the old helper but not yet unregistered it leaves `SMAppService`
        // reporting `enabled`, so this apply dispatches — and the helper it
        // reaches answers `Retired`, which is a refusal and never a licence to
        // use the password path. The slot is not consulted before dispatch,
        // deliberately: `TryActivate` is the admission check, and the reply is
        // what says the helper is on its way out.
        let world = World::answering(HelperReply::Retired { activation: None });

        let result = apply(&world);

        assert_refused(&world, &result);
        assert!(result.stderr.contains("being replaced"));
        assert_eq!(world.acts(), vec![Act::Dispatched]);
    }

    #[test]
    fn an_apply_during_a_replacement_refuses_on_the_absence_path_too() {
        // The same gap, reached the other way: an `enabled` registration whose
        // helper has already been killed by the replacement's unregister.
        let world = World {
            replacement_in_flight: true,
            dispatch: RefCell::new(Some(Err(HelperClientError::Unreachable(
                std::io::Error::from(std::io::ErrorKind::ConnectionRefused),
            )))),
            ..World::default()
        };

        let result = apply(&world);

        assert_refused(&world, &result);
        assert!(result.stderr.contains("being replaced"));
    }
}
