import {
  addIcon,
  CachedMetadata,
  EditableFileView,
  MarkdownPreviewView,
  MarkdownView,
  Plugin,
  TFile,
} from "obsidian";
import React from "react";
import ReactDOM from "react-dom";
import { FileEntity } from "./model/FileEntity";
import { TwohopLink } from "./model/TwohopLink";
import TwohopLinksRootView from "./ui/TwohopLinksRootView";
import { TagLinks } from "./model/TagLinks";
import { path2linkText, removeBlockReference } from "./utils";
import {
  DEFAULT_SETTINGS,
  TwohopPluginSettings,
  TwohopSettingTab,
} from "./Settings";

const CONTAINER_CLASS = "twohop-links-container";

export default class TwohopLinksPlugin extends Plugin {
  settings: TwohopPluginSettings;
  enabled: boolean;

  async onload(): Promise<void> {
    console.debug("------ loading obsidian-twohop-links plugin");

    await this.loadSettings();

    this.enabled = true;

    this.app.workspace.on("file-open", async () => {
      if (this.enabled) {
        await this.renderTwohopLinks();
      }
    });
    this.app.metadataCache.on("resolve", async (file) => {
      if (this.enabled) {
        const activeFile: TFile = this.app.workspace.getActiveFile();
        if (activeFile != null) {
          if (file.path == activeFile.path) {
            await this.renderTwohopLinks();
          }
        }
      }
    });
    this.addCommand({
      id: "enable-2hop-links",
      name: "Enable 2hop links",
      checkCallback: this.enable.bind(this),
    });
    this.addCommand({
      id: "disable-2hop-links",
      name: "Disable 2hop links",
      checkCallback: this.disable.bind(this),
    });

    addIcon(
      "2hop-link",
      `<rect width="32" height="14" rx="3" fill="currentColor"/>
      <rect y="36" width="32" height="15" rx="3" fill="currentColor"/>
      <rect x="68" width="32" height="14" rx="3" fill="currentColor"/>
      <rect x="68" y="36" width="32" height="15" rx="3" fill="currentColor"/>
      <rect x="68" y="16" width="32" height="15" rx="3" fill="currentColor"/>
      <rect x="68" y="53" width="32" height="14" rx="3" fill="currentColor"/>
      <rect x="68" y="69" width="32" height="15" rx="3" fill="currentColor"/>
      <rect x="68" y="86" width="32" height="14" rx="3" fill="currentColor"/>
      <path d="M31 7H69M31 43H69" stroke="currentColor" stroke-width="3"/>
      <path fill-rule="evenodd" clip-rule="evenodd" d="M46.5 20.5783V7H49.5V20.5783C49.5 21.4067 50.1716 22.0783 51 22.0783H69V25.0783H51C48.5147 25.0783 46.5 23.0636 46.5 20.5783ZM46.5 43.7831H49.5V58.8614H69V61.8614H49.5V74.4036H69V77.4036H49.5V90C49.5 90.8284 50.1716 91.5 51 91.5H69V94.5H51C48.5147 94.5 46.5 92.4853 46.5 90V43.7831Z" fill="currentColor"/>`
    );

    this.addRibbonIcon("2hop-link", "Toggle-2hop-links", () =>
      this.enabled ? this.disable.bind(this)() : this.enable.bind(this)()
    );

    this.addSettingTab(new TwohopSettingTab(this.app, this));
  }

  enable(check: boolean): boolean {
    if (check) {
      return !this.enabled;
    }

    this.enabled = true;
    this.renderTwohopLinks().then(() =>
      console.debug("Rendered two hop links")
    );
    return true;
  }

  disable(check: boolean): boolean {
    if (check) {
      return this.enabled;
    }

    this.enabled = false;
    this.removeTwohopLinks();
    return true;
  }

  removeTwohopLinks(): void {
    const markdownViews = this.app.workspace.getLeavesOfType("markdown");
    for (const markdownView of markdownViews) {
      for (const element of this.getContainerElements(
        // @ts-ignore
        markdownView.containerEl
      )) {
        if (element) {
          element.remove();
        }
      }
    }
  }

  private async renderTwohopLinks(): Promise<void> {
    if (!this.enabled) return;

    const markdownView: MarkdownView =
      this.app.workspace.getActiveViewOfType(MarkdownView);
    if (markdownView == null) {
      return;
    }

    // Open the editing file
    const activeFile = markdownView.file;
    if (activeFile == null) {
      return; // Currently focusing window is not related to a file.
    }

    const activeFileCache: CachedMetadata =
      this.app.metadataCache.getFileCache(activeFile);

    // Aggregate forward links
    const forwardLinks = this.getForwardLinks(activeFile, activeFileCache);
    const forwardLinkSet = new Set<string>(forwardLinks.map((it) => it.key()));

    let linkedPathSet = new Set<string>();

    const backwardLinks = this.getBackLinks(
      activeFile,
      forwardLinkSet,

      this.settings.excludesDuplicateLinks ? linkedPathSet : undefined
    );

    // Aggregate links
    const unresolvedTwoHopLinks = this.settings.excludeFrontLink
      ? []
      : this.getTwohopLinks(
          activeFile,
          this.app.metadataCache.unresolvedLinks,
          forwardLinkSet,
          this.settings.excludesDuplicateLinks ? linkedPathSet : undefined
        );

    const resolvedTwoHopLinks = this.settings.excludeFrontLink
      ? []
      : this.getTwohopLinks(
          activeFile,
          this.app.metadataCache.resolvedLinks,
          forwardLinkSet,
          this.settings.excludesDuplicateLinks ? linkedPathSet : undefined
        );

    // Aggregate TwohopLinks by Backlink
    const backlinkTwoHopLinks = this.settings.excludeBacklink
      ? { unresolvedTwoHopLinks: [], resolvedTwoHopLinks: [] }
      : this.getBacklinktwoHopLinks(
          activeFile,
          backwardLinks,
          forwardLinkSet,
          this.settings.excludesDuplicateLinks ? linkedPathSet : undefined
        );

    const twoHopLinkSets = new Set<string>(
      unresolvedTwoHopLinks
        .concat(resolvedTwoHopLinks)
        .map((it) => it.link.key())
    );

    const [forwardConnectedLinks, newLinks] =
      await this.splitLinksByConnectivity(forwardLinks, twoHopLinkSets);

    const tagLinksList = this.settings.excludeTag
      ? []
      : this.getTagLinksList(activeFile, activeFileCache);

    // insert links to the footer
    for (const container of this.getContainerElements(
      markdownView.containerEl
    )) {
      await this.injectTwohopLinks(
        forwardConnectedLinks,
        newLinks,
        backwardLinks,
        unresolvedTwoHopLinks,
        resolvedTwoHopLinks,
        backlinkTwoHopLinks.unresolvedTwoHopLinks,
        backlinkTwoHopLinks.resolvedTwoHopLinks,
        tagLinksList,
        container
      );
    }
  }

  private getContainerElements(containerEl: HTMLElement): Element[] {
    if (this.settings.putOnTop) {
      const elements = containerEl.querySelectorAll(
        `.markdown-source-view .CodeMirror-scroll,
        .markdown-preview-view,
        .markdown-source-view .cm-contentContainer`
      );
      console.debug(`getContainerElements: ${elements.length}`);

      const containers: Element[] = [];
      for (let i = 0; i < elements.length; i++) {
        const el = elements.item(i);
        const container: Element = ((): Element => {
          const e = el.querySelector("." + CONTAINER_CLASS);
          if (e) {
            return e;
          } else {
            const c = document.createElement("div");
            c.className = CONTAINER_CLASS;
            el.insertBefore(c, el.firstChild);
            return c;
          }
        })();
        containers.push(container);
      }
      console.debug(`Return container elements: ${containers.length}`);
      return containers;
    } else {
      const elements = containerEl.querySelectorAll(
        `.markdown-source-view .CodeMirror-lines,
        div:not(.markdown-embed-content) > .markdown-preview-view,
        div:not(.markdown-embed-content) > .markdown-source-view .cm-contentContainer`
      );

      const containers: Element[] = [];
      for (let i = 0; i < elements.length; i++) {
        const el = elements.item(i);
        const container =
          el.querySelector("." + CONTAINER_CLASS) ||
          el.createDiv({ cls: CONTAINER_CLASS });
        containers.push(container);
      }
      return containers;
    }
  }

  getTagLinksList(
    activeFile: TFile,
    activeFileCache: CachedMetadata
  ): TagLinks[] {
    if (activeFileCache.tags) {
      const activeFileTagSet = new Set(
        activeFileCache.tags.map((it) => it.tag)
      );
      const tagMap: Record<string, FileEntity[]> = {};
      const seen: Record<string, boolean> = {};
      for (const markdownFile of this.app.vault.getMarkdownFiles()) {
        if (markdownFile == activeFile) {
          continue;
        }
        const cachedMetadata =
          this.app.metadataCache.getFileCache(markdownFile);
        if (cachedMetadata && cachedMetadata.tags) {
          for (const tag of cachedMetadata.tags.filter((it) =>
            activeFileTagSet.has(it.tag)
          )) {
            if (!tagMap[tag.tag]) {
              tagMap[tag.tag] = [];
            }
            if (!seen[markdownFile.path]) {
              const linkText = path2linkText(markdownFile.path);
              tagMap[tag.tag].push(new FileEntity(activeFile.path, linkText));
              seen[markdownFile.path] = true;
            }
          }
        }
      }

      const tagLinksList: TagLinks[] = [];
      for (const tagMapKey of Object.keys(tagMap)) {
        tagLinksList.push(new TagLinks(tagMapKey, tagMap[tagMapKey]));
      }
      return tagLinksList;
    }
    return [];
  }

  private async injectTwohopLinks(
    forwardConnectedLinks: FileEntity[],
    newLinks: FileEntity[],
    backwardConnectedLinks: FileEntity[],
    unresolvedTwoHopLinks: TwohopLink[],
    resolvedTwoHopLinks: TwohopLink[],
    backlinkUnresolvedTwoHopLinks: TwohopLink[],
    backlinkResolvedTwoHopLinks: TwohopLink[],
    tagLinksList: TagLinks[],
    container: Element
  ) {
    ReactDOM.render(
      <TwohopLinksRootView
        forwardConnectedLinks={forwardConnectedLinks}
        newLinks={newLinks}
        backwardConnectedLinks={backwardConnectedLinks}
        unresolvedTwoHopLinks={unresolvedTwoHopLinks}
        resolvedTwoHopLinks={resolvedTwoHopLinks}
        backlinkUnresolvedTwoHopLinks={backlinkUnresolvedTwoHopLinks}
        backlinkResolvedTwoHopLinks={backlinkResolvedTwoHopLinks}
        tagLinksList={tagLinksList}
        onClick={this.openFile.bind(this)}
        getPreview={this.readPreview.bind(this)}
        boxWidth={this.settings.boxWidth}
        boxHeight={this.settings.boxHeight}
      />,
      container
    );
  }

  private async openFile(
    fileEntity: FileEntity,
    newLeaf: boolean
  ): Promise<void> {
    const linkText = removeBlockReference(fileEntity.linkText);

    console.debug(
      `Open file: linkText='${linkText}', sourcePath='${fileEntity.sourcePath}'`
    );
    const file = this.app.metadataCache.getFirstLinkpathDest(
      linkText,
      fileEntity.sourcePath
    );
    if (file == null) {
      if (!confirm(`Create new file: ${linkText}?`)) {
        console.log("Canceled!!");
        return;
      }
    }

    return this.app.workspace.openLinkText(
      fileEntity.linkText,
      fileEntity.sourcePath,
      newLeaf,
      MarkdownPreviewView
    );
  }

  private getTwohopLinks(
    activeFile: TFile,
    links: Record<string, Record<string, number>>,
    forwardLinkSet: Set<string>,
    linkedPathSet: Set<string> | undefined
  ): TwohopLink[] {
    const twoHopLinks: Record<string, FileEntity[]> = {};
    // no unresolved links in this file
    if (links[activeFile.path] == null) {
      return [];
    }
    const twohopLinkList = this.aggregate2hopLinks(
      activeFile,
      links,
      linkedPathSet
    );

    if (twohopLinkList == null) {
      return [];
    }
    for (const k of Object.keys(twohopLinkList)) {
      if (twohopLinkList[k].length > 0) {
        twoHopLinks[k] = twohopLinkList[k]
          .map((it) => {
            const linkText = path2linkText(it);
            if (forwardLinkSet.has(removeBlockReference(linkText))) {
              return null;
            }
            return new FileEntity(activeFile.path, linkText);
          })
          .filter((it) => it);
      }
    }

    return Object.keys(links[activeFile.path])
      .map((path) => {
        return twoHopLinks[path]
          ? new TwohopLink(
              new FileEntity(activeFile.path, path),
              twoHopLinks[path]
            )
          : null;
      })
      .filter((it) => it)
      .filter((it) => it.fileEntities.length > 0);
  }

  private aggregate2hopLinks(
    activeFile: TFile,
    links: Record<string, Record<string, number>>,
    linkedPathSet: Set<string> | undefined
  ): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    const activeFileLinks = new Set(Object.keys(links[activeFile.path]));

    for (const src of Object.keys(links)) {
      if (src == activeFile.path) {
        continue;
      }
      if (links[src] == null) {
        continue;
      }

      for (const dest of Object.keys(links[src])) {
        // FrontLink -> FrontLinkの2hop
        if (activeFileLinks.has(src)) {
          if (!result[src]) {
            result[src] = [];
          }
          if (linkedPathSet !== undefined) {
            if (linkedPathSet.has(dest)) continue;
            linkedPathSet.add(dest);
          }

          result[src].push(dest);
        }

        // FrontLink -> BackLinkの2hop
        if (activeFileLinks.has(dest)) {
          if (!result[dest]) {
            result[dest] = [];
          }
          if (linkedPathSet !== undefined) {
            if (linkedPathSet.has(src)) continue;
            linkedPathSet.add(src);
          }
          result[dest].push(src);
        }
      }
    }

    return result;
  }

  private getBacklinktwoHopLinks(
    activeFile: TFile,
    backwardLinks: FileEntity[],
    forwardLinkSet: Set<string>,
    linkedPathSet: Set<string> | undefined
  ): {
    unresolvedTwoHopLinks: TwohopLink[];
    resolvedTwoHopLinks: TwohopLink[];
  } {
    const convertLinksToTwohopLinks_fromBackLink = (
      sourceFile: TFile,
      links: Record<string, Record<string, number>>,
      twohopLinkList: Record<string, string[]>,
      forwardLinkSet: Set<string>
    ): TwohopLink[] => {
      const twoHopLinks: Record<string, FileEntity[]> = {};

      for (const k of Object.keys(twohopLinkList)) {
        if (twohopLinkList[k].length > 0) {
          twoHopLinks[k] = twohopLinkList[k]
            .map((it) => {
              const linkText = path2linkText(it);
              if (forwardLinkSet.has(removeBlockReference(linkText))) {
                return null;
              }
              return new FileEntity(activeFile.path, linkText);
            })
            .filter((it) => it);
        }
      }

      return Object.keys(links[sourceFile.path])
        .map((path) => {
          return twoHopLinks[path]
            ? new TwohopLink(
                new FileEntity(sourceFile.path, sourceFile.path), //ここが違うだけの関数になっているのでなんとか分解して共通化したい
                twoHopLinks[path]
              )
            : null;
        })
        .filter((it) => it)
        .filter((it) => it.fileEntities.length > 0);
    };

    let unresolvedTwoHopLinks: TwohopLink[] = [];
    let resolvedTwoHopLinks: TwohopLink[] = [];

    for (let backwardFileEntity of backwardLinks) {
      const backwardFile = this.app.metadataCache.getFirstLinkpathDest(
        backwardFileEntity.linkText,
        backwardFileEntity.sourcePath
      );

      if (!(backwardFile instanceof TFile)) continue;

      const backwardFileCache: CachedMetadata =
        this.app.metadataCache.getFileCache(backwardFile);

      const twohopLinkRecord: Record<string, string[]> = {};

      const fowardLinks = this.getForwardLinks(backwardFile, backwardFileCache);

      twohopLinkRecord[backwardFileEntity.sourcePath] = fowardLinks
        .filter((it) => {
          const pathFile = this.app.metadataCache.getFirstLinkpathDest(
            it.linkText,
            it.sourcePath
          );

          if (!(pathFile instanceof TFile)) return false;
          return (
            !linkedPathSet.has(it.linkText) && activeFile.path !== pathFile.path
          );
        })
        .map((it) => it.linkText);

      unresolvedTwoHopLinks = [
        ...unresolvedTwoHopLinks,
        ...convertLinksToTwohopLinks_fromBackLink(
          backwardFile,
          this.app.metadataCache.unresolvedLinks,
          twohopLinkRecord,
          forwardLinkSet
        ),
      ];

      resolvedTwoHopLinks = [
        ...resolvedTwoHopLinks,
        ...convertLinksToTwohopLinks_fromBackLink(
          backwardFile,
          this.app.metadataCache.resolvedLinks,
          twohopLinkRecord,
          forwardLinkSet
        ),
      ];
    }

    return { unresolvedTwoHopLinks, resolvedTwoHopLinks };
  }

  private async splitLinksByConnectivity(
    links: FileEntity[],
    twoHopLinkSets: Set<string>
  ) {
    const connectedLinks: FileEntity[] = [];
    const newLinks: FileEntity[] = [];
    const seen: Record<string, boolean> = {};
    for (const link of links) {
      const key = link.key();
      if (seen[key]) {
        continue;
      }
      seen[key] = true;

      if (
        this.app.metadataCache.getFirstLinkpathDest(
          removeBlockReference(link.linkText),
          link.sourcePath
        )
      ) {
        connectedLinks.push(link);
      } else {
        // Exclude links, that are listed on two hop links
        if (!twoHopLinkSets.has(link.key())) {
          newLinks.push(link);
        }
      }
    }

    return [connectedLinks, newLinks];
  }

  private getForwardLinks(
    activeFile: TFile,
    activeFileCache: CachedMetadata
  ): FileEntity[] {
    if (activeFileCache == null) {
      // sometime, we can't get metadata cache from obsidian.
      console.log(`Missing activeFileCache '${activeFile.path}`);
    } else {
      if (activeFileCache.links != null) {
        const seen = new Set<string>();
        return activeFileCache.links
          .map((it) => {
            const key = removeBlockReference(it.link);
            if (!seen.has(key)) {
              seen.add(key);
              return new FileEntity(activeFile.path, it.link);
            } else {
              return null;
            }
          })
          .filter((it) => it);
      }
    }
    return [];
  }

  private getBackLinks(
    activeFile: TFile,
    forwardLinkSet: Set<string>,
    linkedPathSet: Set<string> | undefined
  ): FileEntity[] {
    const name = activeFile.path;
    const resolvedLinks: Record<string, Record<string, number>> = this.app
      .metadataCache.resolvedLinks;
    const result: FileEntity[] = [];
    for (const src of Object.keys(resolvedLinks)) {
      for (const dest of Object.keys(resolvedLinks[src])) {
        if (dest == name) {
          const linkText = path2linkText(src);
          if (forwardLinkSet.has(linkText)) {
            // ignore files, already listed in forward links.
            continue;
          }
          result.push(new FileEntity(activeFile.path, linkText));
          if (linkedPathSet !== undefined) linkedPathSet.add(src);
        }
      }
    }
    return result;
  }

  private async readPreview(fileEntity: FileEntity) {
    // Do not read non-text files. Especially PDF file.
    if (
      fileEntity.linkText.match(/\.[a-z0-9_-]+$/i) &&
      !fileEntity.linkText.match(/\.(?:md|markdown|txt|text)$/i)
    ) {
      console.debug(`${fileEntity.linkText} is not a plain text file`);
      return "";
    }

    const linkText = removeBlockReference(fileEntity.linkText);
    console.debug(
      `readPreview: getFirstLinkpathDest: ${linkText}, fileEntity.linkText=${fileEntity.linkText}
      sourcePath=${fileEntity.sourcePath}`
    );

    const file = this.app.metadataCache.getFirstLinkpathDest(
      linkText,
      fileEntity.sourcePath
    );
    if (file == null) {
      return "";
    }
    if (file.stat.size > 1000 * 1000) {
      // Ignore large file
      console.debug(
        `File too large(${fileEntity.linkText}): ${file.stat.size}`
      );
      return "";
    }
    const content = await this.app.vault.read(file);

    if (this.settings.showImage) {
      const m = content.match(/!\[\[([^\]]+.(?:png|bmp|jpg))\]\]/);
      if (m) {
        const img = m[1];
        console.debug(`Found image: ${img}`);
        const file = this.app.metadataCache.getFirstLinkpathDest(
          img,
          fileEntity.sourcePath
        );
        console.debug(`Found image: ${img} = file=${file}`);
        if (file) {
          const resourcePath = this.app.vault.getResourcePath(file);
          console.debug(`Found image: ${img} resourcePath=${resourcePath}`);
          return resourcePath;
        }
      }
    }

    // Remove YFM
    const lines = content.replace(/.*^---$/gms, "").split(/\n/);
    return lines
      .filter((it) => {
        return (
          it.match(/\S/) &&
          !it.match(/^#/) && // Skip header line & tag only line.
          !it.match(/^https?:\/\//) // Skip URL only line.
        );
      })
      .first();
  }

  onunload(): void {
    console.log("unloading plugin");
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    return this.saveData(this.settings);
  }
}
