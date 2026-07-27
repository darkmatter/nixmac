import AppKit
import Foundation

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

guard CommandLine.arguments.count == 4,
      let pid = Int32(CommandLine.arguments[1]),
      pid > 0 else {
    fail("usage: cilicon-e2e-graceful-quit PID BUNDLE_ID EXECUTABLE")
}

let expectedBundleID = CommandLine.arguments[2]
let expectedExecutable = URL(fileURLWithPath: CommandLine.arguments[3])
    .resolvingSymlinksInPath()
    .standardizedFileURL

guard let application = NSRunningApplication(processIdentifier: pid) else {
    fail("owned Cilicon process is no longer a running application")
}
guard application.bundleIdentifier == expectedBundleID else {
    fail("owned process bundle identifier does not match Cilicon")
}
guard application.executableURL?.resolvingSymlinksInPath().standardizedFileURL
        == expectedExecutable else {
    fail("owned process executable does not match Cilicon")
}

let matching = NSRunningApplication.runningApplications(
    withBundleIdentifier: expectedBundleID
)
guard matching.count == 1, matching[0].processIdentifier == pid else {
    fail("Cilicon application ownership is ambiguous")
}
guard application.terminate() else {
    fail("normal Cilicon termination request was rejected")
}
