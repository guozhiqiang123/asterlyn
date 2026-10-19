use std::env;
use std::fs;
use std::process::ExitCode;

use asterlyn_plugin_package::{
    AdmissionContext, SUPPORTED_CAPABILITIES, SUPPORTED_PERMISSIONS, inspect_package,
};

fn main() -> ExitCode {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if arguments.len() != 4 {
        eprintln!(
            "usage: asterlyn-plugin-inspect <package.tgz> <owner/repository> <release-version> <host-version>"
        );
        return ExitCode::from(2);
    }
    let bytes = match fs::read(&arguments[0]) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("could not read plugin package: {error}");
            return ExitCode::FAILURE;
        }
    };
    let context = AdmissionContext {
        repository: &arguments[1],
        release_version: arguments[2].strip_prefix('v').unwrap_or(&arguments[2]),
        host_version: &arguments[3],
        sdk_major: 1,
        runtime_protocol: 1,
        supported_capabilities: SUPPORTED_CAPABILITIES,
        supported_permissions: SUPPORTED_PERMISSIONS,
    };
    match inspect_package(&bytes, &context) {
        Ok(report) => match serde_json::to_string_pretty(&report) {
            Ok(report) => {
                println!("{report}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("could not encode admission report: {error}");
                ExitCode::FAILURE
            }
        },
        Err(error) => {
            eprintln!("plugin package rejected: {error}");
            ExitCode::FAILURE
        }
    }
}
