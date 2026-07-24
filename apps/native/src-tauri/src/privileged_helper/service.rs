use crate::privileged_helper::client;
use crate::privileged_helper::protocol::HelperServiceStatus;
#[cfg(target_os = "macos")]
use crate::privileged_helper::protocol::{HELPER_LABEL, HELPER_PLIST_NAME};
use anyhow::Result;

pub fn status() -> HelperServiceStatus {
    let mut status = platform_status();
    status.socket_available = client::socket_available();
    // SMAppService state and a socket path prove nothing about the daemon:
    // only an authenticated round-trip (mutual code-signature validation)
    // shows the connection actually works.
    if status.socket_available {
        match client::status() {
            Ok(response) if response.ok => status.responding = true,
            Ok(response) => {
                status.detail = Some(response.error.unwrap_or_else(|| {
                    "helper answered the status probe with an error".to_string()
                }));
            }
            Err(error) => status.detail = Some(format!("{error:#}")),
        }
    }
    status
}

pub fn register() -> Result<HelperServiceStatus> {
    platform_register()?;
    Ok(status())
}

pub fn unregister() -> Result<HelperServiceStatus> {
    platform_unregister()?;
    Ok(status())
}

pub fn open_login_items_settings() {
    platform_open_login_items_settings();
}

#[cfg(target_os = "macos")]
fn platform_status() -> HelperServiceStatus {
    match macos::service_status() {
        Ok(raw) => HelperServiceStatus {
            label: HELPER_LABEL.to_string(),
            available: true,
            registered: raw != macos::SM_APP_SERVICE_STATUS_NOT_REGISTERED,
            authorized: raw == macos::SM_APP_SERVICE_STATUS_ENABLED,
            socket_available: false,
            responding: false,
            detail: Some(macos::describe_status(raw).to_string()),
        },
        Err(error) => HelperServiceStatus::unavailable(error.to_string()),
    }
}

#[cfg(not(target_os = "macos"))]
fn platform_status() -> HelperServiceStatus {
    HelperServiceStatus::unavailable("SMAppService is only available on macOS")
}

#[cfg(target_os = "macos")]
fn platform_register() -> Result<()> {
    macos::register_service()
}

#[cfg(not(target_os = "macos"))]
fn platform_register() -> Result<()> {
    anyhow::bail!("SMAppService is only available on macOS")
}

#[cfg(target_os = "macos")]
fn platform_unregister() -> Result<()> {
    macos::unregister_service()
}

#[cfg(not(target_os = "macos"))]
fn platform_unregister() -> Result<()> {
    anyhow::bail!("SMAppService is only available on macOS")
}

#[cfg(target_os = "macos")]
fn platform_open_login_items_settings() {
    macos::open_login_items_settings();
}

#[cfg(not(target_os = "macos"))]
fn platform_open_login_items_settings() {}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
mod macos {
    use super::HELPER_PLIST_NAME;
    use anyhow::{Result, anyhow};
    use cocoa::base::{BOOL, NO, nil};
    use cocoa::foundation::{NSAutoreleasePool, NSString};
    use objc::runtime::{Class, Object};
    use objc::{msg_send, sel, sel_impl};
    use std::ptr;

    #[link(name = "ServiceManagement", kind = "framework")]
    unsafe extern "C" {}

    pub const SM_APP_SERVICE_STATUS_NOT_REGISTERED: i64 = 0;
    pub const SM_APP_SERVICE_STATUS_ENABLED: i64 = 1;
    pub const SM_APP_SERVICE_STATUS_REQUIRES_APPROVAL: i64 = 2;
    pub const SM_APP_SERVICE_STATUS_NOT_FOUND: i64 = 3;

    pub fn describe_status(status: i64) -> &'static str {
        match status {
            SM_APP_SERVICE_STATUS_NOT_REGISTERED => "notRegistered",
            SM_APP_SERVICE_STATUS_ENABLED => "enabled",
            SM_APP_SERVICE_STATUS_REQUIRES_APPROVAL => "requiresApproval",
            SM_APP_SERVICE_STATUS_NOT_FOUND => "notFound",
            _ => "unknown",
        }
    }

    pub fn service_status() -> Result<i64> {
        unsafe {
            let _pool = NSAutoreleasePool::new(nil);
            let service = daemon_service()?;
            let status: i64 = msg_send![service, status];
            Ok(status)
        }
    }

    pub fn register_service() -> Result<()> {
        unsafe {
            let _pool = NSAutoreleasePool::new(nil);
            let service = daemon_service()?;
            let mut error: *mut Object = ptr::null_mut();
            let ok: BOOL = msg_send![service, registerAndReturnError: &mut error];
            if ok == NO {
                return Err(ns_error(error, "SMAppService register failed"));
            }
            Ok(())
        }
    }

    pub fn unregister_service() -> Result<()> {
        unsafe {
            let _pool = NSAutoreleasePool::new(nil);
            let service = daemon_service()?;
            let mut error: *mut Object = ptr::null_mut();
            let ok: BOOL = msg_send![service, unregisterAndReturnError: &mut error];
            if ok == NO {
                return Err(ns_error(error, "SMAppService unregister failed"));
            }
            Ok(())
        }
    }

    pub fn open_login_items_settings() {
        unsafe {
            let Some(class) = Class::get("SMAppService") else {
                fallback_open_login_items_settings();
                return;
            };
            let _: () = msg_send![class, openSystemSettingsLoginItems];
        }
    }

    unsafe fn daemon_service() -> Result<*mut Object> {
        let class = Class::get("SMAppService")
            .ok_or_else(|| anyhow!("SMAppService is unavailable on this macOS version"))?;
        let plist = unsafe { NSString::alloc(nil).init_str(HELPER_PLIST_NAME) };
        let service: *mut Object = msg_send![class, daemonServiceWithPlistName: plist];
        if service.is_null() {
            return Err(anyhow!("SMAppService did not return a daemon service"));
        }
        Ok(service)
    }

    unsafe fn ns_error(error: *mut Object, fallback: &str) -> anyhow::Error {
        if error.is_null() {
            return anyhow!("{fallback}");
        }
        let description: *mut Object = msg_send![error, localizedDescription];
        if description.is_null() {
            return anyhow!("{fallback}");
        }
        let c_string: *const std::os::raw::c_char = msg_send![description, UTF8String];
        if c_string.is_null() {
            return anyhow!("{fallback}");
        }
        anyhow!(
            unsafe { std::ffi::CStr::from_ptr(c_string) }
                .to_string_lossy()
                .into_owned()
        )
    }

    fn fallback_open_login_items_settings() {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
            .spawn();
    }
}
