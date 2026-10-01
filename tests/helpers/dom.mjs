import { element } from "./browser.mjs";

// Model the DOM boundary: replacing markup detaches controls and drops focus.
export function domContainer(root) {
  let markup = root.innerHTML || "";
  let controls = [];
  const parse = () => {
    controls = [...markup.matchAll(/<(button|input|textarea|div|p)\b([^>]*)>/g)].map((match) => {
      const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((entry) => [entry[1], entry[2]]));
      // HTML parsing removes one leading newline before decoding textarea text.
      const textareaValue = match[1] === "textarea"
        ? markup.slice(match.index + match[0].length).split("</textarea>")[0]
          .replace(/\r\n?/g, "\n").replace(/^\n/, "")
          .replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name])
        : "";
      const control = {
        ...element(),
        tagName: match[1].toUpperCase(),
        id: attributes.id || "",
        value: textareaValue,
        defaultValue: textareaValue,
        hidden: /\bhidden(?:\s|=|$)/.test(match[2]),
        isConnected: true,
        attributes,
        dataset: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith("data-")).map(([key, value]) => [key.slice(5), value])),
        get ariaDisabled() { return attributes["aria-disabled"] ?? null; },
        set ariaDisabled(value) {
          if (value == null) delete attributes["aria-disabled"];
          else attributes["aria-disabled"] = String(value);
        },
        getAttribute: (key) => attributes[key] ?? null,
        setAttribute: (key, value) => { attributes[key] = String(value); },
        focus() { document.activeElement = this; },
      };
      let disabled = false;
      Object.defineProperty(control, "disabled", {
        get: () => disabled,
        set(value) {
          disabled = value;
          if (value && document.activeElement === control) document.activeElement = document.body;
        },
      });
      return control;
    });
  };
  parse();
  root.contains = (node) => controls.includes(node);
  root.focus = () => { document.activeElement = root; };
  root.querySelector = (selector) => controls.find((control) => {
    if (selector.startsWith("#")) return control.id === selector.slice(1);
    if (selector.startsWith(".")) return control.attributes.class?.split(" ").includes(selector.slice(1));
    const tag = selector.match(/^[a-z]+/i)?.[0];
    const attributes = [...selector.matchAll(/\[([\w-]+)="([^"]*)"\]/g)];
    return (!tag || control.tagName.toLowerCase() === tag) && attributes.length &&
      attributes.every(([, key, value]) => control.getAttribute(key) === value);
  });
  Object.defineProperty(root, "innerHTML", {
    get: () => markup,
    set(value) {
      if (root.contains(document.activeElement)) document.activeElement = document.body;
      for (const control of controls) control.isConnected = false;
      markup = value;
      parse();
    },
  });
  return root;
}
