package com.voxo.app

import android.app.Application
import android.content.res.Configuration
import android.os.Environment
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(VoxoSmsAutoReplyPackage())
        }
    )
  }

  /**
   * DIAGNOSTIC ONLY — writes any uncaught crash (Java/Kotlin-level: JS
   * bridge setup, native module registration, anything below the RN JS
   * error boundary) to a plain text file in Downloads, readable from the
   * phone's own file manager with no USB/adb needed. Chains to the
   * previous default handler afterward so the crash still happens
   * normally — this only adds a readable record of why.
   *
   * Does NOT catch a raw native (C++/NDK) crash below the JVM — only
   * what Java's own Thread.UncaughtExceptionHandler can see.
   */
  private fun installCrashLogger() {
    val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        val timestamp = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(Date())
        val text = "VOXO crash — $timestamp\nThread: ${thread.name}\n\n$sw"
        // Tried in order: a world-readable public Downloads path (needs
        // WRITE_EXTERNAL_STORAGE, which the manifest only requests up to
        // API 32 — scoped storage on 33+ makes this throw), then this
        // app's own external-files dir (no permission needed on any
        // version, but only this app, and a file manager with "show
        // Android/data" turned on, can browse to it), then internal
        // storage as a last resort that is guaranteed to accept the
        // write even if nothing outside this app can ever read it back.
        val candidates = listOf(
          { File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "voxo_crash_$timestamp.txt") },
          { File(getExternalFilesDir(null), "voxo_crash_$timestamp.txt") },
          { File(filesDir, "voxo_crash_$timestamp.txt") },
        )
        for (candidate in candidates) {
          try {
            val logFile = candidate()
            logFile.parentFile?.mkdirs()
            logFile.writeText(text)
            break
          } catch (_: Throwable) {
            // Try the next, less convenient but more likely to succeed, location.
          }
        }
      } catch (_: Throwable) {
        // Best-effort diagnostic write — must never be the reason the
        // real crash handler doesn't also run.
      }
      previousHandler?.uncaughtException(thread, throwable)
    }
  }

  override fun onCreate() {
    super.onCreate()
    installCrashLogger()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
