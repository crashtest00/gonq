import { WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { loadImage } from '../platform/images';
import { editorHost } from './host';

/**
 * A Markdown image shown as an image. Equal widgets (same source and alt text) keep their DOM when the
 * decorations are rebuilt, so typing elsewhere never reloads the picture; the load itself is cached too.
 */
export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    el.className = 'cm-image cm-image-loading';
    const fail = (e: unknown) => {
      el.className = 'cm-image cm-image-missing';
      el.textContent = `🖼 ${this.alt || this.src}`;
      el.title = e instanceof Error ? e.message : `${this.src} could not be loaded`;
    };
    loadImage(this.src, view.state.facet(editorHost).docPath()).then((url) => {
      const img = document.createElement('img');
      img.alt = this.alt;
      img.draggable = false;
      img.addEventListener('error', () => fail(new Error(`${this.src} could not be loaded`)));
      img.addEventListener('load', () => view.requestMeasure());
      img.src = url;
      el.className = 'cm-image';
      el.replaceChildren(img);
    }, fail);
    return el;
  }
  get estimatedHeight() {
    return 120;
  }
  ignoreEvent() {
    return false;
  }
}
