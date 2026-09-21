import './ImportGuidance.css';

export function ImportGuidance() {
  return <div className="import-guidance">
    <p className="import-limits">Up to 60 seconds · 200 MiB · 1080p</p>
    <details>
      <summary>Formats and import changes</summary>
      <p>MP4 or MOV recommended. Other video formats depend on decoder support; the file is checked during import.</p>
      <p>Landscape and portrait supported: up to 2,073,600 pixels per frame, with neither side above 1,920 pixels.</p>
      <p>We keep your original and create a 30 fps H.264 working copy with AAC audio when present. Frame rate is converted; odd dimensions are rounded down to even pixels and pixels are made square.</p>
    </details>
  </div>;
}
