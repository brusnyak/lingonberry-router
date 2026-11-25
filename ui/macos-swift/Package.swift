// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "LingonberryBar",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "LingonberryBar", targets: ["LingonberryBar"])
    ],
    targets: [
        .executableTarget(
            name: "LingonberryBar",
            path: "Sources/LingonberryBar"
        )
    ]
)
