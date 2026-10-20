const { compactAX, safeUrl } = require('./bridge.cjs');
let nextSnapshot = 1;

class PageAutomation {
  constructor() { this.references = new Map(); }
  async cdp(tab, method, args = {}) {
    if (!tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.attach('1.3');
    return tab.view.webContents.debugger.sendCommand(method, args);
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
    for (const frame of frames) {
      if (args.frame && frame.id !== args.frame) continue;
      try {
        const result = await this.cdp(tab, 'Accessibility.getFullAXTree', { frameId: frame.id });
        for (const node of compactAX(result.nodes, 1000)) {
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
  async upload(tab, ref, files) {
    const value = this.resolve(tab, ref);
    const valid = await this.nodeCall(tab, ref, "function() { return this instanceof HTMLInputElement && this.type === 'file'; }");
    if (!valid) throw new Error('Select a file input reference from inspect');
    await this.cdp(tab, 'DOM.setFileInputFiles', { backendNodeId: value.backendNodeId, files });
    return { attached: files.length };
  }
}
module.exports = { PageAutomation };
