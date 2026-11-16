export function connectScrollSync(first, second) {
  const positions = new WeakMap([[first, first.scrollTop], [second, second.scrollTop]]);
  for (const [source, target] of [[first, second], [second, first]]) {
    source.addEventListener("scroll", () => {
      const top = source.scrollTop;
      if (positions.get(source) === top) return;
      positions.set(source, top);
      if (target.scrollTop !== top) target.scrollTop = top;
      positions.set(target, target.scrollTop);
    }, { passive: true });
  }
}
