const { compactAX, safeUrl } = require('./bridge.cjs');
let nextSnapshot = 1;

class PageAutomation {
  constructor() { this.references = new Map(); }
  async cdp(tab, method, args = {}) {
    const dbg = tab.view.webContents.debugger;
    if (!dbg.isAttached()) {
      dbg.attach('1.3');
      // Background studios lack OS focus; emulate focus so menus, popovers and key events behave as on screen.
      try { await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch {}
    }
    return dbg.sendCommand(method, args);
  }
  invalidate(tab) {
    for (const [ref, value] of this.references) if (value.tab === tab) this.references.delete(ref);
  }
  async inspect(tab, args = {}) {
    this.invalidate(tab);
    const snapshot = nextSnapshot++;
    const tree = await this.cdp(tab, 'Page.getFrameTree');
    const frames = [];
    const walk = node => { frames.push({ id: node.frame.id, url: safeUrl(node.frame.url) }); (node.childFrames || []).forEach(walk); };
    walk(tree.frameTree);
    const nodes = []; const warnings = [];
    const limit = Math.min(1000, Math.max(10, Number(args.limit) || 250));
    // offset skips that many compacted nodes per frame, so callers can read past the 1000-node window
    // (e.g. a dialog rendered after a long list). Refs are still issued only for returned nodes.
    const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
    for (const frame of frames) {
      if (args.frame && frame.id !== args.frame) continue;
      try {
        const result = await this.cdp(tab, 'Accessibility.getFullAXTree', { frameId: frame.id });
        for (const node of compactAX(result.nodes, 1000 + offset).slice(offset)) {
          if (args.query && !`${node.role} ${node.name}`.toLowerCase().includes(String(args.query).toLowerCase())) continue;
          if (nodes.length >= limit) break;
          const ref = node.backendId ? `s${snapshot}e${nodes.length + 1}` : undefined;
          if (ref) this.references.set(ref, { tab, backendNodeId: node.backendId, generation: tab.generation });
          const { backendId, ...publicNode } = node;
          nodes.push({ ref, frame: frame.id, ...publicNode });
        }
      } catch { warnings.push(`Frame ${frame.id} could not be inspected; use the native preview for this frame.`); }
    }
    // Upload widgets commonly hide their real input from the accessibility tree.
    // Expose omitted controls with a fixed query without enabling DOM events.
    if (!args.frame || args.frame === frames[0]?.id) {
      try {
        const group = `automato-files-${snapshot}`;
        const { result } = await this.cdp(tab, 'Runtime.evaluate', { expression: "Array.from(document.querySelectorAll('input[type=file]'))", objectGroup: group });
        let inputs;
        try { inputs = (await this.cdp(tab, 'Runtime.getProperties', { objectId: result.objectId, ownProperties: true })).result.filter(item => /^\d+$/.test(item.name) && item.value?.objectId); }
        catch (error) { await this.cdp(tab, 'Runtime.releaseObjectGroup', { objectGroup: group }); throw error; }
        const existing = new Set([...this.references.values()].filter(value => value.tab === tab).map(value => value.backendNodeId));
        try { for (const input of inputs) {
          if (nodes.length >= limit) break;
          const { node } = await this.cdp(tab, 'DOM.describeNode', { objectId: input.value.objectId, depth: 0 });
          if (existing.has(node.backendNodeId)) continue;
          const attributes = {}; for (let i = 0; i < (node.attributes || []).length; i += 2) attributes[node.attributes[i]] = node.attributes[i + 1];
          const name = attributes['aria-label'] || attributes.name || attributes.id || 'File upload';
          if (args.query && !`fileinput upload ${name}`.toLowerCase().includes(String(args.query).toLowerCase())) continue;
          const ref = `s${snapshot}e${nodes.length + 1}`;
          this.references.set(ref, { tab, backendNodeId: node.backendNodeId, generation: tab.generation });
          nodes.push({ ref, frame: frames[0].id, role: 'fileinput', name, accept: attributes.accept || '', multiple: 'multiple' in attributes, accessibilityHidden: true });
        } } finally { await this.cdp(tab, 'Runtime.releaseObjectGroup', { objectGroup: group }); }
      } catch { warnings.push('Some file inputs could not be inspected.'); }
    }
    return { tab: tab.id, snapshot, url: safeUrl(tab.view.webContents.getURL()), title: tab.view.webContents.getTitle(), frames, nodes, warnings };
  }
  resolve(tab, ref) {
    const value = this.references.get(ref);
    if (!value || value.tab !== tab || value.generation !== tab.generation) throw new Error('Stale element reference. Inspect the current tab again.');
    return value;
  }
  async nodeCall(tab, ref, functionDeclaration, args = []) {
    const value = this.resolve(tab, ref);
    const resolved = await this.cdp(tab, 'DOM.resolveNode', { backendNodeId: value.backendNodeId });
    const objectId = resolved.object.objectId;
    try {
      const response = await this.cdp(tab, 'Runtime.callFunctionOn', { objectId, functionDeclaration, arguments: args.map(value => ({ value })), returnByValue: true, userGesture: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Page action failed');
      return response.result.value;
    } finally { await this.cdp(tab, 'Runtime.releaseObject', { objectId }).catch(() => {}); }
  }
  async hover(tab, ref) {
    // Move the pointer over an element so hover-only toolbars (e.g. download buttons) appear.
    const value = this.resolve(tab, ref);
    await this.cdp(tab, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: value.backendNodeId });
    const { quads } = await this.cdp(tab, 'DOM.getContentQuads', { backendNodeId: value.backendNodeId });
    if (!quads?.length) throw new Error('Element is not visible; inspect again or scroll first');
    const q = quads[0], x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4;
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 5, y: y - 5 });
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    return { hovered: ref };
  }
  async click(tab, ref) {
    const value = this.resolve(tab, ref);
    await this.cdp(tab, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: value.backendNodeId });
    const { quads } = await this.cdp(tab, 'DOM.getContentQuads', { backendNodeId: value.backendNodeId });
    if (!quads?.length) throw new Error('Element is not visible; inspect again or scroll first');
    const q = quads[0], x = (q[0] + q[2] + q[4] + q[6]) / 4, y = (q[1] + q[3] + q[5] + q[7]) / 4;
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    return { clicked: ref };
  }
  async fill(tab, ref, text) {
    const valid = await this.nodeCall(tab, ref, `function() {
      if (!(this instanceof HTMLInputElement || this instanceof HTMLTextAreaElement || this.isContentEditable)) return false;
      this.focus(); if (this.isContentEditable) { const r = document.createRange(); r.selectNodeContents(this); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } else this.select(); return true;
    }`);
    if (!valid) throw new Error('Element is not a text field');
    await this.cdp(tab, 'Input.insertText', { text: String(text) });
    return { filled: ref };
  }
  async uploadPicker(tab, ref, files) {
    if (!Array.isArray(files) || files.length !== 1) throw new Error('Picker upload requires exactly one approved file');
    this.resolve(tab, ref);
    const dbg = tab.view.webContents.debugger;
    await this.cdp(tab, 'Page.enable');
    await this.cdp(tab, 'Page.setInterceptFileChooserDialog', { enabled: true });
    let timer, listener;
    const opened = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('No file chooser event from selected upload control')), 8000);
      listener = (_event, method, params) => { if (method === 'Page.fileChooserOpened') resolve(params); };
      dbg.on('message', listener);
    });
    try {
      await this.click(tab, ref);
      const chooser = await opened;
      if (!chooser.backendNodeId) throw new Error('Chooser has no file-input backend node');
      const { node } = await this.cdp(tab, 'DOM.describeNode', { backendNodeId: chooser.backendNodeId });
      const attrs = node.attributes || [];
      if (node.nodeName !== 'INPUT' || !attrs.some((v, i) => i % 2 === 0 && v === 'type' && attrs[i + 1] === 'file')) throw new Error('Chooser target is not a file input');
      await this.cdp(tab, 'DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files });
      return { attached: files.length, mechanism: 'file-chooser-event', backendNodeId: chooser.backendNodeId, frameId: chooser.frameId };
    } finally {
      clearTimeout(timer); if (listener) dbg.removeListener('message', listener);
      await this.cdp(tab, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    }
  }
  async upload(tab, ref, files) {
    const value = this.resolve(tab, ref);
    const valid = await this.nodeCall(tab, ref, "function() { return this instanceof HTMLInputElement && this.type === 'file'; }");
    if (!valid) throw new Error('Select a file input reference from inspect');
    await this.cdp(tab, 'DOM.setFileInputFiles', { backendNodeId: value.backendNodeId, files });
    return { attached: files.length };
  }
}
module.exports = { PageAutomation };
