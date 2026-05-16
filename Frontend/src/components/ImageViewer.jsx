// frontend/src/components/ImageViewer.jsx

import { useState } from 'react'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'

// ✅ FIX: reemplaza host interno docker por localhost accesible desde el browser
function fixMinioUrl(url) {
  if (!url) return url;
  return url.replace("http://minio:9000", "http://localhost:9000");
}

export default function ImageViewer({ src, alt, media, gradcamUrl: gradcamProp }) {
  const [showGradcam, setShowGradcam] = useState(false)
  const [brightness,  setBrightness]  = useState(100)
  const [contrast,    setContrast]    = useState(100)

  // ✅ FIX aplicado en todas las fuentes de URL
  const imgUrl     = fixMinioUrl(src || media?.presigned_url || media?.content?.url)
  const gradcamUrl = fixMinioUrl(gradcamProp || media?.gradcam_url)

  const imgStyle = {
    filter: `brightness(${brightness}%) contrast(${contrast}%)`,
    maxWidth: '100%',
    display: 'block',
    borderRadius: 'var(--radius-md)',
    userSelect: 'none',
  }

  if (!imgUrl) {
    return (
      <div style={{
        padding: '2rem', textAlign: 'center',
        color: 'var(--text-muted)', background: '#000',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-subtle)',
      }}>
        Imagen no disponible
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Controles de imagen */}
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {gradcamUrl && (
          <button
            className="btn btn-ghost"
            onClick={() => setShowGradcam(v => !v)}
            style={{ fontSize: '0.8125rem', padding: '0.375rem 0.75rem' }}
          >
            {showGradcam ? 'Ocultar Grad-CAM' : 'Ver Grad-CAM'}
          </button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <span>Brillo</span>
          <input type="range" min={20} max={200} value={brightness}
            onChange={e => setBrightness(Number(e.target.value))}
            style={{ width: 90, accentColor: 'var(--cyan)' }} />
          <span style={{ minWidth: 36, fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
            {brightness}%
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <span>Contraste</span>
          <input type="range" min={20} max={200} value={contrast}
            onChange={e => setContrast(Number(e.target.value))}
            style={{ width: 90, accentColor: 'var(--cyan)' }} />
          <span style={{ minWidth: 36, fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
            {contrast}%
          </span>
        </label>
      </div>

      {/* Visor — original vs Grad-CAM side by side */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: showGradcam && gradcamUrl ? '1fr 1fr' : '1fr',
        gap: '1rem',
      }}>
        {/* Imagen original */}
        <div>
          {showGradcam && gradcamUrl && (
            <p style={{ marginBottom: '0.375rem', textAlign: 'center',
              fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              Original
            </p>
          )}
          <div style={{
            background: '#000', borderRadius: 'var(--radius-md)',
            overflow: 'hidden', border: '1px solid var(--border-subtle)',
            maxHeight: 400,
          }}>
            <TransformWrapper limitToBounds={false}>
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <div style={{
                    display: 'flex', gap: '0.375rem', padding: '0.375rem',
                    background: 'var(--bg-elevated)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    {[['＋', zoomIn], ['－', zoomOut], ['⟲', resetTransform]].map(([lbl, fn]) => (
                      <button key={lbl} onClick={() => fn()} style={{
                        background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                        color: 'var(--text-secondary)', borderRadius: 4,
                        padding: '2px 8px', cursor: 'pointer', fontSize: '0.875rem',
                      }}>{lbl}</button>
                    ))}
                  </div>
                  <TransformComponent>
                    <img
                      src={imgUrl}
                      alt={alt || 'Imagen médica'}
                      style={imgStyle}
                      onError={(e) => {
                        e.target.style.display = 'none'
                        e.target.parentNode.insertAdjacentHTML('beforeend',
                          '<div style="padding:2rem;text-align:center;color:#4d6a8a">Error al cargar imagen</div>')
                      }}
                    />
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
          </div>
        </div>

        {/* Grad-CAM */}
        {showGradcam && gradcamUrl && (
          <div>
            <p style={{ marginBottom: '0.375rem', textAlign: 'center',
              fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
              Grad-CAM — Zonas de atención
            </p>
            <div style={{
              background: '#000', borderRadius: 'var(--radius-md)',
              overflow: 'hidden', border: '1px solid var(--border-active)',
              maxHeight: 400,
            }}>
              <TransformWrapper limitToBounds={false}>
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    <div style={{
                      display: 'flex', gap: '0.375rem', padding: '0.375rem',
                      background: 'var(--bg-elevated)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      {[['＋', zoomIn], ['－', zoomOut], ['⟲', resetTransform]].map(([lbl, fn]) => (
                        <button key={lbl} onClick={() => fn()} style={{
                          background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
                          color: 'var(--text-secondary)', borderRadius: 4,
                          padding: '2px 8px', cursor: 'pointer', fontSize: '0.875rem',
                        }}>{lbl}</button>
                      ))}
                    </div>
                    <TransformComponent>
                      <img src={gradcamUrl} alt="Mapa Grad-CAM" style={imgStyle} />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            </div>
          </div>
        )}
      </div>

      <p style={{
        fontSize: '0.75rem', color: 'var(--text-tertiary)',
        fontStyle: 'italic', marginTop: '0.25rem',
      }}>
        ⚠ Imagen de uso clínico interno. No distribuir sin autorización.
      </p>
    </div>
  )
}