# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# --- Keeps required now that R8 runs on release builds -------------------
# (android.enableMinifyInReleaseBuilds=true in gradle.properties)

# Expo's module registry finds modules by reflection, so their class and
# method names must survive minification.
-keep class expo.modules.** { *; }
-keep class * extends expo.modules.core.interfaces.Package { *; }
-keepclassmembers class * { @expo.modules.core.interfaces.ExpoProp *; }

# React Native's bridge/JNI surface is resolved by name from C++ and JS.
-keep class com.facebook.jni.** { *; }
-keepclassmembers class * { @com.facebook.react.uimanager.annotations.ReactProp <methods>; }
-keepclassmembers class * { @com.facebook.react.bridge.ReactMethod <methods>; }

# OkHttp (the HTTP stack behind axios' RN adapter and Socket.IO) ships
# optional Conscrypt/Animal-Sniffer references R8 would otherwise warn on.
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# Hermes/JSC entry points.
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.react.bridge.** { *; }

# Add any project specific keep options here:
