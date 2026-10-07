import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  screen,
  globalShortcut,
  ipcMain,
  session as electronSession,
  desktopCapturer,
  systemPreferences,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  tokenSchema,
  selectionSchema,
  correctionSchema,
  settingsSchema,
  frameSchema,
  captureFailureSchema,
  playedMoveSchema,
  type Snapshot,
  type Token,
  type CaptureCommand,
} from "../shared/contracts";
import { Stockfish } from "./engine";
import { CloudAI } from "./cloud";
import { Store } from "./store";
import { Session } from "./session";
import { clampWindow, MouseEpoch } from "../core/desktop";
import { allowCapturePermission, denyDisplayCapture } from "./capture-permission";
import { captureFailureMessage } from "../core/capture-errors";
import { sessionIsActive, automaticTrackingEnabled } from "../core/session-controls";

app.setName("Chess Helper");
app.setPath(
  "userData",
  path.join(app.getPath("appData"), "com.colesladowsky.chesshelper"),
);
app.setAppUserModelId("com.colesladowsky.chesshelper");
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
let coach: BrowserWindow;
let tray: Tray;
let controller: Session;
let store: Store;
const windows = new Map<string, BrowserWindow>();
const mouse = new MouseEpoch();
let selectedSource: string | null = null;
const offeredSources = new Set<string>();
let quitting = false;
const devURL = !app.isPackaged ? process.env.CHESS_HELPER_DEV_URL : undefined;
if (devURL && devURL !== "http://127.0.0.1:5173")
  throw new Error("Unsupported development origin");
const rendererFile = path.join(__dirname, "../renderer/index.html");
const qualified = false; // Recorded production fixtures have not yet qualified this release.
const sessionPartition = "chess-helper-session";
const preload = path.join(__dirname, "../preload/preload.cjs");
function localURL(url: string) {
  try {
    const parsed = new URL(url);
    return devURL
      ? parsed.origin === devURL && parsed.pathname === "/"
      : parsed.protocol === "file:" &&
          parsed.pathname ===
            new URL(pathToFileURL(rendererFile).href).pathname;
  } catch {
    return false;
  }
}
function sender(event: IpcMainInvokeEvent, roles?: string[]) {
  const role = [...windows].find(
    ([, window]) => window.webContents === event.sender,
  )?.[0];
  if (
    !role ||
    !event.senderFrame ||
    event.senderFrame !== event.sender.mainFrame ||
    !localURL(event.senderFrame.url) ||
    (roles && !roles.includes(role))
  )
    throw new Error("Untrusted IPC sender");
  return role;
}
function broadcast(snapshot: Snapshot) {
  for (const window of windows.values())
    if (!window.isDestroyed())
      window.webContents.send("chess:snapshot", snapshot);
  refreshMenus();
}
function capture(command: CaptureCommand) {
  if (coach && !coach.isDestroyed())
    coach.webContents.send("chess:capture", command);
}
function protect(window: BrowserWindow) {
  window.setContentProtection(true);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!localURL(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
}
async function load(window: BrowserWindow, role: string) {
  if (devURL) await window.loadURL(`${devURL}/?view=${role}`);
  else await window.loadFile(rendererFile, { query: { view: role } });
}
function showCoach() {
  if (!coach.isVisible()) {
    mouse.show();
    coach.setIgnoreMouseEvents(true, { forward: true });
    coach.showInactive();
  }
  coach.webContents.send("chess:visibility", true);
}
app.on("second-instance", () => {
  if (coach && !coach.isDestroyed()) showCoach();
});
function hideCoach() {
  mouse.hide();
  coach.setIgnoreMouseEvents(true, { forward: true });
  coach.hide();
  coach.webContents.send("chess:visibility", false);
}
function toggleCoach() {
  coach.isVisible() ? hideCoach() : showCoach();
  refreshMenus();
}
function auxiliary(role: "settings" | "selection" | "correction") {
  const existing = windows.get(role);
  if (existing) {
    existing.show();
    existing.focus();
    return;
  }
  if (role === "selection" || role === "correction") controller.pause();
  const window = new BrowserWindow({
    width: role === "selection" ? 900 : 670,
    height: role === "settings" ? 650 : 790,
    minWidth: 520,
    minHeight: 520,
    show: false,
    title: `Chess Helper ${role === "settings" ? "Settings" : role === "selection" ? "Select Board" : "Correct Position"}`,
    minimizable: false,
    fullscreenable: false,
    webPreferences: {
      preload,
      partition: sessionPartition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  windows.set(role, window);
  protect(window);
  window.on("closed", () => windows.delete(role));
  void load(window, role).then(() => {
    window.show();
    window.focus();
  });
}
function menuItems(): Electron.MenuItemConstructorOptions[] {
  const state = controller?.snapshot();
  return [
    {
      label: coach?.isVisible() ? "Hide Helper" : "Show Helper",
      click: toggleCoach,
    },
    {
      label: state && sessionIsActive(state) ? "Pause" : state && !automaticTrackingEnabled(state) ? "Analyze Position" : "Start",
      click: () => (state && sessionIsActive(state) ? controller.pause() : controller.start()),
    },
    { label: "Rescan Board", click: () => controller.rescan() },
    { label: "Select Board…", click: () => auxiliary("selection") },
    { label: "Correct Position…", click: () => auxiliary("correction") },
    {
      label: "Retry Explanation",
      click: () => controller.requestExplanation(),
    },
    { label: "Restart Engine", click: () => void controller.restartEngine() },
    { type: "separator" },
    {
      label: "Settings…",
      accelerator: "Command+,",
      click: () => auxiliary("settings"),
    },
    { type: "separator" },
    { role: "quit", label: "Quit Chess Helper" },
  ];
}
function refreshMenus() {
  if (!controller || !tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(menuItems()));
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: "Chess Helper", submenu: menuItems() },
      { role: "editMenu" },
      {
        label: "Window",
        submenu: [
          {
            label: "Close Window",
            accelerator: "Command+W",
            click: () => {
              const focused = BrowserWindow.getFocusedWindow();
              if (focused === coach) hideCoach();
              else focused?.close();
            },
          },
        ],
      },
    ]),
  );
}
function shortcuts(settings: z.infer<typeof settingsSchema>): string[] {
  globalShortcut.unregisterAll();
  const conflicts: string[] = [];
  for (const [name, accelerator] of Object.entries(settings.shortcuts)) {
    try {
      const ok = globalShortcut.register(
        accelerator,
        name === "toggle"
          ? toggleCoach
          : name === "pause"
            ? () =>
                sessionIsActive(controller.snapshot())
                  ? controller.pause()
                  : controller.start()
            : () => controller.rescan(),
      );
      if (!ok) conflicts.push(`${name}: ${accelerator}`);
    } catch {
      conflicts.push(`${name}: ${accelerator}`);
    }
  }
  return conflicts;
}
function invoke<T extends z.ZodType>(
  name: string,
  schema: T,
  roles: string[] | undefined,
  handler: (value: z.infer<T>, event: IpcMainInvokeEvent) => unknown,
  revision = true,
) {
  ipcMain.handle(`chess:${name}`, async (event, payload) => {
    sender(event, roles);
    const parsed = schema.parse(payload);
    if (revision) controller.assertCurrent(parsed as Token);
    return handler(parsed, event);
  });
}
async function browserSources() {
  const permission = systemPreferences.getMediaAccessStatus("screen");
  if (permission === "denied" || permission === "restricted")
    throw new Error(captureFailureMessage(permission, "permission-denied"));
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 360, height: 220 },
    fetchWindowIcons: false,
  });
  return sources.filter(
    (source) =>
      /Chrome|Safari|Firefox|Edge|Brave|Arc|Opera|Vivaldi|Chess\.com|Lichess/i.test(
        source.name,
      ) && !/Chess Helper/i.test(source.name),
  );
}
function registerIPC() {
  invoke(
    "snapshot",
    z.undefined(),
    undefined,
    () => controller.snapshot(),
    false,
  );
  invoke("sources", tokenSchema, ["selection"], async (token) => {
    const sources = await browserSources();
    controller.assertCurrent(token);
    offeredSources.clear();
    sources.forEach((s) => offeredSources.add(s.id));
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });
  invoke(
    "source",
    tokenSchema.extend({ sourceId: z.string().max(100) }).strict(),
    ["selection"],
    (value) => {
      if (!offeredSources.has(value.sourceId))
        throw new Error("Select an offered browser window");
      selectedSource = value.sourceId;
      controller.sourceChanged();
    },
  );
  invoke("selection", selectionSchema, ["selection"], (value) => {
    if (value.sourceId !== selectedSource)
      throw new Error("Source changed. Select it again.");
    controller.select(value);
    windows.get("selection")?.close();
    showCoach();
  });
  invoke("correct", correctionSchema, ["correction"], (value) => {
    controller.correct(value);
    windows.get("correction")?.close();
    showCoach();
  });
  invoke("played-move", playedMoveSchema, ["coach"], (value) => controller.recordMove(value));
  invoke("start", tokenSchema, ["coach"], () => controller.start());
  invoke("pause", tokenSchema, ["coach"], () => controller.pause());
  invoke("rescan", tokenSchema, ["coach"], () => controller.rescan());
  invoke(
    "frame",
    frameSchema,
    ["coach"],
    (value) => controller.frame(value),
    false,
  );
  invoke(
    "capture-error",
    captureFailureSchema,
    ["coach"],
    (value) => {
      if (controller.isCurrent(value))
        controller.fail(
          "capture",
          captureFailureMessage(systemPreferences.getMediaAccessStatus("screen"), value.code),
          "Select Board",
        );
    },
    false,
  );
  invoke(
    "settings",
    tokenSchema
      .extend({
        settings: settingsSchema,
        apiKey: z.string().max(512).optional(),
      })
      .strict(),
    ["settings"],
    (value) => {
      if (value.settings.automaticTracking && !qualified)
        throw new Error(
          "This release has not passed the recorded-board fixture gate. Use manual Rescan.",
        );
      store.save(value.settings, value.apiKey);
      controller.settings(value.settings, shortcuts(value.settings));
    },
  );
  invoke("explain", tokenSchema, ["coach"], () =>
    controller.requestExplanation(),
  );
  invoke("restart-engine", tokenSchema, ["coach"], () =>
    controller.restartEngine(),
  );
  invoke(
    "open",
    z.enum(["settings", "selection", "correction"]),
    ["coach"],
    (value) => auxiliary(value),
    false,
  );
  invoke("hide", z.undefined(), ["coach"], hideCoach, false);
  invoke("quit", z.undefined(), ["coach", "settings"], () => {
    setImmediate(() => app.quit());
  }, false);
  invoke(
    "cursor",
    z.undefined(),
    ["coach"],
    () => {
      if (!mouse.visible || !coach.isVisible())
        return { visible: false, epoch: mouse.epoch, x: -1, y: -1 };
      const point = screen.getCursorScreenPoint();
      const bounds = coach.getContentBounds();
      const zoom = coach.webContents.getZoomFactor();
      return {
        visible: true,
        epoch: mouse.epoch,
        x: (point.x - bounds.x) / zoom,
        y: (point.y - bounds.y) / zoom,
      };
    },
    false,
  );
  invoke(
    "hit-test",
    z.object({ epoch: z.number().int(), interactive: z.boolean() }).strict(),
    ["coach"],
    (value) => {
      if (!mouse.accepts(value.epoch) || !coach.isVisible()) return;
      coach.setIgnoreMouseEvents(!value.interactive, { forward: true });
    },
    false,
  );
  invoke(
    "permission",
    z.undefined(),
    ["selection"],
    () => systemPreferences.getMediaAccessStatus("screen"),
    false,
  );
  invoke(
    "screen-settings",
    z.undefined(),
    ["selection"],
    () =>
      shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
      ),
    false,
  );
}
app
  .whenReady()
  .then(async () => {
    if (!ownsInstance) return;
    app.dock?.hide();
    const captureSession = electronSession.fromPartition(sessionPartition, {
      cache: false,
    });
    store = new Store(app.getPath("userData"));
    const engineDir = app.isPackaged
      ? path.join(process.resourcesPath, "stockfish")
      : path.join(app.getAppPath(), "resources/stockfish");
    const engine = new Stockfish(
      path.join(engineDir, "stockfish"),
      engineDir,
      () =>
        controller?.fail(
          "engine",
          "Stockfish stopped. Restart Engine to recover.",
          "Restart Engine",
        ),
    );
    controller = new Session({
      engine,
      cloud: new CloudAI(() => store.apiKey()),
      settings: store.settings,
      hasApiKey: () => store.hasApiKey,
      trackingQualified: () => qualified,
      emit: broadcast,
      capture,
    });
    const geometry = clampWindow(
      store.geometry ?? {
        x: screen.getPrimaryDisplay().workArea.x + 60,
        y: screen.getPrimaryDisplay().workArea.y + 80,
        width: 420,
        height: 750,
      },
      screen.getAllDisplays().map((d) => d.workArea),
    );
    coach = new BrowserWindow({
      ...geometry,
      minWidth: 340,
      minHeight: 480,
      frame: false,
      transparent: true,
      resizable: true,
      alwaysOnTop: true,
      show: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload,
        partition: sessionPartition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    windows.set("coach", coach);
    protect(coach);
    coach.setAlwaysOnTop(true, "floating");
    coach.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    coach.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        hideCoach();
      }
    });
    coach.on("hide", () => {
      mouse.hide();
      coach.setIgnoreMouseEvents(true, { forward: true });
      coach.webContents.send("chess:visibility", false);
    });
    coach.on("show", () => {
      mouse.show();
      coach.webContents.send("chess:visibility", true);
    });
    coach.on("closed", () => {
      mouse.hide();
      windows.delete("coach");
    });
    coach.webContents.on("render-process-gone", () => controller.pause());
    let geometryTimer: ReturnType<typeof setTimeout>;
    const saveGeometry = () => {
      clearTimeout(geometryTimer);
      geometryTimer = setTimeout(() => {
        if (!coach.isDestroyed()) store.saveGeometry(coach.getBounds());
      }, 250);
    };
    coach.on("move", saveGeometry);
    coach.on("resize", () => {
      if (coach.isVisible()) mouse.show();
      saveGeometry();
      coach.webContents.send("chess:visibility", coach.isVisible());
    });
    screen.on("display-metrics-changed", () =>
      coach.setBounds(
        clampWindow(
          coach.getBounds(),
          screen.getAllDisplays().map((d) => d.workArea),
        ),
      ),
    );
    const captureContentsAllowed = (contents: Electron.WebContents | null) =>
      !!contents &&
      [...windows].some(
        ([role, window]) =>
          ["coach", "selection"].includes(role) &&
          window.webContents === contents,
      );
    captureSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        callback(
          allowCapturePermission({
            kind: "request",
            permission,
            trustedContents: captureContentsAllowed(contents),
            sourceSelected: !!selectedSource,
            trustedURL: localURL(details.requestingUrl),
            isMainFrame: details.isMainFrame,
            mediaTypes: "mediaTypes" in details ? details.mediaTypes : undefined,
          }),
        );
      },
    );
    captureSession.setPermissionCheckHandler(
      (contents, permission, _origin, details) => {
        return allowCapturePermission({
          kind: "check",
          permission: String(permission),
          trustedContents: captureContentsAllowed(contents),
          sourceSelected: !!selectedSource,
          trustedURL: !!details.requestingUrl && localURL(details.requestingUrl),
          isMainFrame: details.isMainFrame,
        });
      },
    );
    captureSession.setDisplayMediaRequestHandler(
      async (request, callback) => {
        try {
          const frame = request.frame;
          const own =
            frame &&
            [...windows].some(
              ([role, window]) =>
                ["coach", "selection"].includes(role) &&
                window.webContents.mainFrame === frame,
            ) &&
            localURL(frame.url);
          if (
            !own ||
            !selectedSource ||
            !request.videoRequested ||
            request.audioRequested
          ) {
            denyDisplayCapture(callback);
            return;
          }
          const sourceId = selectedSource;
          const source = (await browserSources()).find(
            (s) => s.id === sourceId,
          );
          if (
            !source ||
            selectedSource !== sourceId ||
            !frame ||
            frame.isDestroyed() ||
            !localURL(frame.url)
          ) {
            denyDisplayCapture(callback);
            return;
          }
          callback({ video: source });
        } catch {
          denyDisplayCapture(callback);
        }
      },
      { useSystemPicker: false },
    );
    registerIPC();
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, "trayTemplate.png")
      : path.join(app.getAppPath(), "resources/trayTemplate.png");
    const icon = nativeImage
      .createFromPath(iconPath)
      .resize({ width: 18, height: 18 });
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip("Chess Helper");
    controller.conflicts(shortcuts(store.settings));
    refreshMenus();
    tray.on("click", toggleCoach);
    await load(coach, "coach");
    showCoach();
    let checking = false;
    setInterval(async () => {
      if (
        checking ||
        !controller.snapshot().selection ||
        (!controller.snapshot().running &&
          controller.snapshot().status.state !== "Reading board")
      )
        return;
      checking = true;
      const token = controller.token();
      const source = selectedSource;
      try {
        if (
          systemPreferences.getMediaAccessStatus("screen") === "denied" ||
          !(await browserSources()).some((s) => s.id === source)
        ) {
          if (controller.isCurrent(token))
            controller.fail(
              "capture",
              "The browser window closed or capture permission changed. Select Board again.",
              "Select Board",
            );
        }
      } catch {
        if (controller.isCurrent(token))
          controller.fail(
            "capture",
            "Capture is unavailable. Check Screen Recording permission.",
            "Select Board",
          );
      } finally {
        checking = false;
      }
    }, 2000).unref();
  })
  .catch(() => {
    /* No credentials, screenshots, or positions in logs. */ app.quit();
  });
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  quitting = true;
  controller?.shutdown();
  globalShortcut.unregisterAll();
  if (coach && !coach.isDestroyed() && store)
    store.saveGeometry(coach.getBounds());
});
// No analytics, notifications, sound, Dock bouncing, or website automation.
