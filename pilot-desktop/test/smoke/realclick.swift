// Pilot for Mac 1.5.1: a tiny helper for the smoke test on macOS (CI only,
// never shipped). It moves the real system pointer and clicks with real
// system mouse events, the way a person's mouse does, so the smoke test can
// click the robot while he walks through macOS's own event path (Playwright's
// clicks go straight into the window and skip the click-through overlay).
//
//   swiftc -O test/smoke/realclick.swift -o realclick
//   realclick trusted          -> "trusted" or "not trusted" (Accessibility)
//   realclick where            -> the pointer's place: "x y" (screen points)
//   realclick move X Y         -> moves the pointer there
//   realclick click X Y        -> moves there, presses and lets go
//
// Points are global screen points, top-left of the main display (as
// Electron's screen module uses).
import ApplicationServices
import CoreGraphics
import Foundation

func post(_ type: CGEventType, _ p: CGPoint) {
  let src = CGEventSource(stateID: .hidSystemState)
  CGEvent(mouseEventSource: src, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}

let args = CommandLine.arguments
func point() -> CGPoint {
  guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else {
    FileHandle.standardError.write("need X Y\n".data(using: .utf8)!)
    exit(2)
  }
  return CGPoint(x: x, y: y)
}

switch args.count > 1 ? args[1] : "" {
case "trusted":
  print(AXIsProcessTrusted() ? "trusted" : "not trusted")
case "where":
  let p = CGEvent(source: nil)?.location ?? .zero
  print("\(p.x) \(p.y)")
case "move":
  post(.mouseMoved, point())
  usleep(30_000)
case "click":
  let p = point()
  post(.mouseMoved, p)
  usleep(40_000)
  post(.leftMouseDown, p)
  usleep(70_000)
  post(.leftMouseUp, p)
  usleep(30_000)
default:
  FileHandle.standardError.write("usage: realclick trusted | where | move X Y | click X Y\n".data(using: .utf8)!)
  exit(2)
}
