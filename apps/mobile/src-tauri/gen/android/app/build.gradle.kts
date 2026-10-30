import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    namespace = "com.gonq.app"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.gonq.app"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
}

repositories {
    // The Kotlin half of rustls-platform-verifier (see docs/android-tls-gradle.md).
    maven {
        url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/")
        content { includeGroup("rustls") }
    }
}

// Reads the version of rustls-platform-verifier-android from the repo's Cargo.lock, so the Kotlin half always matches the Rust crate.
abstract class RustlsVersion : ValueSource<String, RustlsVersion.Params> {
    interface Params : ValueSourceParameters {
        val lockFile: RegularFileProperty
    }

    companion object {
        const val CRATE_NAME = "rustls-platform-verifier-android"
    }

    override fun obtain(): String {
        val lines = parameters.lockFile.get().asFile.readLines()
        val nameIdx = lines.indexOfFirst { it.trim() == "name = \"$CRATE_NAME\"" }
        val version = if (nameIdx < 0) null else lines.drop(nameIdx + 1)
            .firstOrNull { it.trimStart().startsWith("version = ") }
            ?.substringAfter('"', "")
            ?.substringBefore('"', "")
            ?.takeIf { it.isNotEmpty() }
        return version ?: error("$CRATE_NAME not found in Cargo.lock")
    }
}

// app/ -> android -> gen -> src-tauri -> mobile -> apps -> repo root
val rustlsPlatformVerifierVersion = providers.of(RustlsVersion::class.java) {
    parameters.lockFile.set(layout.projectDirectory.file("../../../../../../Cargo.lock"))
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("rustls:rustls-platform-verifier:${rustlsPlatformVerifierVersion.get()}")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
