//! The native half of the GHOST Protocol install check (test/install/install.spec.mjs): JSON lines on stdin in, JSON lines on stdout out, one
//! reply for each request, answered by block/buzz-app's own `buzzodz-plugins` crate and by nothing of ours. The browser's `invoke` for the
//! plugin commands is routed here; the page, Settings, the review and the loader are the app's own.
//!
//! It is a pass-through. Each command is the body of the Tauri command of the same name in src-tauri/src/lib.rs, minus what only the desktop
//! has: windows, deep links, and the federated identity of a community repository (the assertion and authorization `plugin_import_git` asks for,
//! and the registrations `plugin_change` retires). The result of each is the same: a catalog read that fails is the `Recovery` reply, as there. The crate functions it calls, and nothing else:
//!
//!   Manager::open, Manager::catalog, Manager::module, Manager::change, Manager::managed, Manager::external_plugins_paused,
//!   Manager::repository_access, imports::prepare_git_authorized, imports::RequiredCommit::parse, imports::prepare_folder,
//!   PreparedImport::install, and the crate's own `InstallationResult` for the shape of a catalog reply.
//!
//! `plugin_import_folder` has no folder picker to ask, so it reads the one folder named on the command line, as the picker's answer.
//!
//!   bridge <absolute plugin home> [<folder plugin_import_folder reads>]
//!
//! Request: {"id": n, "command": "plugin_catalog", "args": {...}}. Reply: {"id": n, "ok": ...} or {"id": n, "err": "..."}.
//! Requests run on their own threads, as the app runs its commands, so a catalog read is answered while a clone is under way.
use buzzodz_plugins::imports::{self, PreparedImport};
use buzzodz_plugins::{Catalog, InstallationResult, Manager};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

type Pending = Arc<Mutex<Option<PreparedImport>>>;

/// src-tauri/src/lib.rs `ready`.
fn ready(manager: &Manager, catalog: Catalog) -> Value {
    serde_json::to_value(InstallationResult::Ready {
        managed: manager.managed(&catalog),
        catalog,
        external_plugins_paused: manager.external_plugins_paused(),
    })
    .unwrap()
}

/// src-tauri/src/lib.rs `prepare_import`: one import at a time; the new preview replaces the one before it.
fn prepare(pending: &Pending, operation: impl FnOnce() -> Result<PreparedImport, String>) -> Result<Value, String> {
    let mut slot = pending.try_lock().map_err(|_| "Another import is in progress")?;
    *slot = None;
    *slot = Some(operation()?);
    Ok(json!(slot.as_ref().map(|prepared| &prepared.preview)))
}

fn handle(manager: &Manager, pending: &Pending, folder: Option<&Path>, command: &str, args: &Value) -> Result<Value, String> {
    let text = |key: &str| args[key].as_str();
    let required = |key: &str| text(key).ok_or(format!("{command} needs {key}"));
    match command {
        "plugin_catalog" => Ok(match manager.catalog() {
            Ok(catalog) => ready(manager, catalog),
            Err(reason) => serde_json::to_value(InstallationResult::Recovery { reason, can_reset: true }).unwrap(),
        }),
        "plugin_import_git" => {
            let commit = text("commit").map(imports::RequiredCommit::parse).transpose()?;
            let acquire = || {
                imports::prepare_git_authorized(
                    required("repository")?,
                    text("reference").unwrap_or(""),
                    text("path"),
                    commit,
                    text("authorization"),
                    None,
                    None,
                    &manager.repository_access(),
                )
            };
            if args["checkOnly"].as_bool() == Some(true) {
                return acquire().map(|prepared| json!(prepared.preview));
            }
            prepare(pending, acquire)
        }
        "plugin_import_folder" => {
            let folder = folder.ok_or("This check was given no plugin folder")?;
            prepare(pending, || imports::prepare_folder(folder))
        }
        "plugin_import_discard" => {
            let mut slot = pending.try_lock().map_err(|_| "Another import is in progress")?;
            if slot.as_ref().is_some_and(|prepared| Some(prepared.preview.token.as_str()) == text("token")) {
                *slot = None;
            }
            Ok(Value::Null)
        }
        "plugin_import_install" => {
            let slot = pending.try_lock().map_err(|_| "Another import is in progress")?;
            slot.as_ref()
                .ok_or("This import preview expired. Choose the source again.")?
                .install(manager, required("token")?, required("path")?)
                .map(|catalog| ready(manager, catalog))
        }
        "plugin_module" => manager.module(required("id")?, required("revision")?).map(Value::from),
        "plugin_change" => manager.change(required("action")?, required("id")?).map(|catalog| ready(manager, catalog)),
        _ => Err(format!("Unexpected command {command}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let home = PathBuf::from(&args[0]);
    assert!(home.is_absolute(), "the plugin home must be an absolute path");
    let folder = args.get(1).map(PathBuf::from);
    let manager = Manager::open(Some(home), "install-check", false).expect("open the plugin home");
    let pending: Pending = Arc::default();
    let stdout = Arc::new(Mutex::new(std::io::stdout()));
    for line in std::io::stdin().lock().lines() {
        let line = line.expect("read a request");
        let (manager, pending, folder, stdout) = (manager.clone(), pending.clone(), folder.clone(), stdout.clone());
        std::thread::spawn(move || {
            let request: Value = serde_json::from_str(&line).expect("a request is JSON");
            let command = request["command"].as_str().unwrap_or("");
            let reply = match handle(&manager, &pending, folder.as_deref(), command, &request["args"]) {
                Ok(ok) => json!({ "id": request["id"], "ok": ok }),
                Err(err) => json!({ "id": request["id"], "err": err }),
            };
            let mut stdout = stdout.lock().unwrap();
            writeln!(stdout, "{reply}").unwrap();
            stdout.flush().unwrap();
        });
    }
}
