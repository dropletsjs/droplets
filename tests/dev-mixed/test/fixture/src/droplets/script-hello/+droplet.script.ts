type Runs = { els: HTMLElement[]; cleanups: number; texts: string[] };

/** Plain browser code: it counts its runs and cleanups on `window`, for the test. */
export default function run(_data: unknown, el: HTMLElement) {
  const runs = ((globalThis as { scriptRuns?: Runs }).scriptRuns ??= { els: [], cleanups: 0, texts: [] });
  const text = "Script greets the host";
  runs.els.push(el);
  runs.texts.push(text);
  const section = document.createElement("section");
  section.dataset["testid"] = "script";
  const p = document.createElement("p");
  p.dataset["text"] = "";
  p.textContent = text;
  section.append(p);
  el.append(section);
  return () => {
    runs.cleanups += 1;
  };
}
