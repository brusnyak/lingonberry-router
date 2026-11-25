// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LingonberryUI",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "lingonberry-ui", targets: ["LingonberryUI"]),
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "LingonberryUI",
            dependencies: [],
            path: "Sources/LingonberryUI",
            linkerSettings: [
                .linkedFramework("SwiftUI"),
                .linkedFramework("AppKit"),
            ]
        ),
    ]
)
