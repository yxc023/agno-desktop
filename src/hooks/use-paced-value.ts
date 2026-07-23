import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { PacedValueController, type PacedValueOptions } from "@/lib/paced-value";

export interface UsePacedValueOptions extends PacedValueOptions {
  /**
   * 流式状态信号；true 时按 paceMs 节流，false 时一次性跟上。
   * 通常传入 `() => message.status === "streaming"`。
   */
  isLive: () => boolean;
}

/**
 * usePacedValue — React 包装层。
 *
 * 给一个快速增长的值（典型场景：流式 markdown 文本），返回"按节流释放"
 * 的当前值。直接挂到下游组件的 props 上，配合 React.memo 可以让下游在
 * "shown 不变"的 tick 上跳过 render。
 *
 * 用 useSyncExternalStore 订阅 controller 的变化，StrictMode 安全。
 * useEffect（无 deps）在每次 render 后 push 最新值 → controller 内部
 * dedup + 决定同步释放 / 排队 tick。
 */
export function usePacedValue(
  getValue: () => string,
  options: UsePacedValueOptions
): string {
  const { isLive, ...controllerOpts } = options;
  const controllerRef = useRef<PacedValueController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new PacedValueController(
      getValue(),
      controllerOpts
    );
  }

  const subscribe = useCallback(
    (cb: () => void) => controllerRef.current!.subscribe(cb),
    []
  );
  const getSnapshot = useCallback(
    () => controllerRef.current!.current,
    []
  );
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    controllerRef.current!.push(getValue(), isLive());
  });

  useEffect(() => {
    const c = controllerRef.current!;
    return () => {
      c.destroy();
    };
  }, []);

  return value;
}