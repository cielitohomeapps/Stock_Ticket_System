import React from 'react'

export default function OutputPanel({ output, setOutput }) {
  return (
    <section className="panel output-panel">
      <div className="output-header">
        <h2>Respuesta backend</h2>
        <button className="ghost" onClick={() => setOutput('Listo para probar.')}>
          Limpiar
        </button>
      </div>
      <pre aria-live="polite">{output}</pre>
    </section>
  )
}
