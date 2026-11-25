// A release build must be a GUI binary: without this the Windows build opens a
// console window beside the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    icyteru_lib::run()
}
