import { useEffect, useRef } from "react";
import { downloadReleases } from "@/downloads";

export function DownloadPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="download-page" aria-labelledby="download-heading">
      <header className="download-intro">
        <h1 id="download-heading" ref={headingRef} tabIndex={-1}>下载</h1>
        <p>选择适合你电脑的版本，文件由 GitHub Releases 提供。</p>
      </header>
      <div className="download-grid">
        {downloadReleases.map((release) => (
          <article className="download-card" data-os={release.os} key={release.os} aria-labelledby={`download-${release.os}`}>
            <header className="download-card-header">
              <div>
                <h2 id={`download-${release.os}`}>{release.name}</h2>
                <p>{release.compatibility}</p>
              </div>
              <div className="download-badges">
                <span className="download-version">{release.version}</span>
                {release.preview && <strong className="download-preview">测试版</strong>}
              </div>
            </header>
            <div className="download-options">
              {release.installers.map((installer) => (
                <a className="download-option" href={installer.url} key={installer.url}>
                  <span><strong>{installer.label}</strong><small>{installer.description}</small></span>
                  <span className="download-arrow" aria-hidden="true">↓</span>
                </a>
              ))}
            </div>
            <div className={`download-notice ${release.preview ? "download-notice-preview" : ""}`}>
              {release.preview && <strong>下载前请注意</strong>}
              {release.notices.map((notice) => <p key={notice}>{notice}</p>)}
            </div>
            <footer className="download-card-footer">
              <a href={release.releaseNotesUrl}>发行说明</a>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
