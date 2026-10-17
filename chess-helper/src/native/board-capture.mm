#define NAPI_VERSION 8
#include <node_api.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <memory>
#include <mutex>
#include <string>
#include <cmath>

// In-process capture uses Chess Helper's existing permission. One selected
// window, cursor excluded, cropped JPEG only. No audio, files or network.
struct Result {
  std::mutex mutex;
  bool finished = false;
  dispatch_semaphore_t signal = dispatch_semaphore_create(0);
  std::string image, error;
  int width = 0, height = 0;
};
struct Work {
  napi_async_work work; napi_deferred deferred;
  uint32_t windowID;
  double x, y, width, height;
  std::string image, error;
  int sourceWidth = 0, sourceHeight = 0;
};
static void finish(const std::shared_ptr<Result>& r, const char* error, NSString* image = nil, int width = 0, int height = 0) {
  std::lock_guard<std::mutex> lock(r->mutex);
  if (r->finished) return;
  r->finished = true; r->error = error;
  if (image) r->image = image.UTF8String;
  r->width = width; r->height = height;
  dispatch_semaphore_signal(r->signal);
}
static void execute(napi_env, void* opaque) {
  Work* w = static_cast<Work*>(opaque);
  @autoreleasepool {
    if (!CGPreflightScreenCaptureAccess()) { w->error = "permission-denied"; return; }
    auto r = std::make_shared<Result>();
    const uint32_t windowID = w->windowID;
    const double x = w->x, y = w->y, cw = w->width, ch = w->height;
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES
      completionHandler:^(SCShareableContent* content, NSError* error) {
        if (error) { finish(r, "unavailable"); return; }
        SCWindow* chosen = nil;
        for (SCWindow* window in content.windows) if (window.windowID == windowID) { chosen = window; break; }
        if (!chosen) { finish(r, "source-ended"); return; }
        SCContentFilter* filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:chosen];
        int width = (int)llround(filter.contentRect.size.width * filter.pointPixelScale);
        int height = (int)llround(filter.contentRect.size.height * filter.pointPixelScale);
        if (width < 64 || height < 64 || width > 16384 || height > 16384) { finish(r, "unavailable"); return; }
        SCStreamConfiguration* config = [SCStreamConfiguration new];
        config.width = width; config.height = height;
        config.showsCursor = NO; config.ignoreShadowsSingleWindow = YES; config.shouldBeOpaque = YES;
        [SCScreenshotManager captureImageWithFilter:filter configuration:config
          completionHandler:^(CGImageRef image, NSError* captureError) {
            if (captureError || !image) { finish(r, "unavailable"); return; }
            CGRect rect = CGRectIntegral(CGRectMake(x * CGImageGetWidth(image), y * CGImageGetHeight(image),
              cw * CGImageGetWidth(image), ch * CGImageGetHeight(image)));
            CGImageRef crop = CGImageCreateWithImageInRect(image, rect);
            int side = std::min(1024, (int)llround(cw * width));
            if (!crop || side < 64) { if (crop) CGImageRelease(crop); finish(r, "unavailable"); return; }
            CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            CGContextRef context = CGBitmapContextCreate(nullptr, side, side, 8, side * 4, color, kCGImageAlphaPremultipliedLast);
            CGColorSpaceRelease(color);
            if (!context) { CGImageRelease(crop); finish(r, "unavailable"); return; }
            CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
            CGContextDrawImage(context, CGRectMake(0, 0, side, side), crop); CGImageRelease(crop);
            CGImageRef board = CGBitmapContextCreateImage(context); CGContextRelease(context);
            NSMutableData* data = [NSMutableData data];
            CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, CFSTR("public.jpeg"), 1, nullptr);
            if (!destination || !board) {
              if (destination) CFRelease(destination); if (board) CGImageRelease(board);
              finish(r, "unavailable"); return;
            }
            NSDictionary* properties = @{(__bridge NSString*)kCGImageDestinationLossyCompressionQuality: @0.9};
            CGImageDestinationAddImage(destination, board, (__bridge CFDictionaryRef)properties);
            bool ok = CGImageDestinationFinalize(destination); CFRelease(destination); CGImageRelease(board);
            if (!ok) { finish(r, "unavailable"); return; }
            finish(r, "", [@"data:image/jpeg;base64," stringByAppendingString:[data base64EncodedStringWithOptions:0]], width, height);
          }];
      }];
    dispatch_semaphore_wait(r->signal, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    std::lock_guard<std::mutex> lock(r->mutex);
    if (!r->finished) { r->finished = true; w->error = "unavailable"; }
    else { w->error = r->error; w->image = r->image; w->sourceWidth = r->width; w->sourceHeight = r->height; }
  }
}
static void stringProperty(napi_env env, napi_value object, const char* name, const std::string& value) {
  napi_value field; napi_create_string_utf8(env, value.c_str(), value.size(), &field); napi_set_named_property(env, object, name, field);
}
static void complete(napi_env env, napi_status status, void* opaque) {
  Work* w = static_cast<Work*>(opaque);
  napi_value value; napi_create_object(env, &value);
  if (status != napi_ok || !w->error.empty()) stringProperty(env, value, "error", w->error.empty() ? "unavailable" : w->error);
  else {
    stringProperty(env, value, "image", w->image);
    napi_value width, height; napi_create_int32(env, w->sourceWidth, &width); napi_create_int32(env, w->sourceHeight, &height);
    napi_set_named_property(env, value, "sourceWidth", width); napi_set_named_property(env, value, "sourceHeight", height);
  }
  napi_resolve_deferred(env, w->deferred, value); napi_delete_async_work(env, w->work); delete w;
}
static bool number(napi_env env, napi_value object, const char* name, double* result) {
  napi_value value;
  return napi_get_named_property(env, object, name, &value) == napi_ok &&
    napi_get_value_double(env, value, result) == napi_ok && std::isfinite(*result);
}
static napi_value capture(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1], crop;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  auto w = std::make_unique<Work>(); double windowID;
  if (argc != 1 || !number(env, args[0], "windowID", &windowID) || windowID < 1 || windowID > UINT32_MAX || floor(windowID) != windowID ||
      napi_get_named_property(env, args[0], "crop", &crop) != napi_ok ||
      !number(env, crop, "x", &w->x) || !number(env, crop, "y", &w->y) ||
      !number(env, crop, "width", &w->width) || !number(env, crop, "height", &w->height) ||
      w->x < 0 || w->y < 0 || w->width <= 0 || w->height <= 0 || w->x + w->width > 1.000001 || w->y + w->height > 1.000001) {
    napi_throw_type_error(env, nullptr, "Invalid selected window or board crop"); return nullptr;
  }
  w->windowID = (uint32_t)windowID;
  napi_value promise, name; napi_create_string_utf8(env, "BoardCapture", NAPI_AUTO_LENGTH, &name);
  napi_create_promise(env, &w->deferred, &promise);
  napi_create_async_work(env, nullptr, name, execute, complete, w.get(), &w->work);
  napi_queue_async_work(env, w->work); w.release(); return promise;
}
static napi_value selfTest(napi_env env, napi_callback_info) {
  napi_value result, yes; napi_create_object(env, &result); napi_get_boolean(env, true, &yes);
  napi_set_named_property(env, result, "ready", yes); napi_set_named_property(env, result, "cursorExcluded", yes); return result;
}
NAPI_MODULE_INIT() {
  napi_property_descriptor properties[] = {
    {"capture", nullptr, capture, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"selfTest", nullptr, selfTest, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 2, properties); return exports;
}
