// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LingonberryBar",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "lingonberry-tray", targets: ["LingonberryBar"]),
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "LingonberryBar",
            path: "Sources/LingonberryBar",
            resources: [.copy("Resources")]
        ),
    ]
)
