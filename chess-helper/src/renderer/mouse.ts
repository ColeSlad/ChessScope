import type { ChessHelperAPI } from "../shared/contracts";
export function installMouseHitTesting(api: ChessHelperAPI) {
  let visible = true;
  let generation = 0;
  let pending = false;
  const poll = async () => {
    if (!visible || pending) return;
    pending = true;
    const request = generation;
    try {
      const cursor = await api.cursor();
      if (!visible || request !== generation || !cursor.visible) return;
      const target = document.elementFromPoint(cursor.x, cursor.y);
      const interactive = !!target?.closest(
        "button,input,textarea,select,a,[data-panel],[data-interactive]",
      );
      await api.hitTest({ epoch: cursor.epoch, interactive });
    } finally {
      pending = false;
    }
  };
  const update = api.onVisibility((value) => {
    visible = value;
    ++generation;
    if (visible) void poll().catch(() => {});
  });
  const timer = setInterval(() => void poll().catch(() => {}), 100);
  const movement = () => void poll().catch(() => {});
  window.addEventListener("mousemove", movement);
  window.addEventListener("resize", movement);
  void poll().catch(() => {});
  return () => {
    visible = false;
    ++generation;
    clearInterval(timer);
    update();
    window.removeEventListener("mousemove", movement);
    window.removeEventListener("resize", movement);
  };
}
