import { useState, useEffect } from "react";
import logoCH from '../assets/logoch.jpeg';

function CielitoHomeLogo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <img src={logoCH} alt="Cielito Home" style={{ height: "72px", objectFit: "contain" }} />
    </div>
  );
}

// Bullet + campo de texto
function CampoTicket({ placeholder, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{
        width: "14px", height: "14px", borderRadius: "50%",
        background: "#5a9e90", flexShrink: 0
      }} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: "#e8efee",
          border: "none",
          borderRadius: "6px",
          padding: "8px 10px",
          fontSize: "13px",
          color: "#1a1a1a",
          outline: "none",
        }}
      />
    </div>
  );
}

/**
 * TicketSalida
 *
 * Props:
 * @param {string}   area        - Nombre del área (vendrá de tu API). Ej: "Compras"
 * @param {boolean}  loadingArea - true mientras la API está cargando el área
 * @param {string[]} campos      - Etiquetas para los campos dinámicos. Default: 3 campos vacíos
 * @param {function} onSubmit    - Callback con los datos del formulario al confirmar
 */
export default function TicketSalida({
  area = "",
  loadingArea = false,
  campos = ["Campo 1", "Campo 2", "Campo 3"],
  onSubmit,
}) {
  const [fecha, setFecha] = useState("");
  const [valoresCampos, setValoresCampos] = useState(() => campos.map(() => ""));
  const [razon, setRazon] = useState("");

  // Si los campos cambian desde afuera (por la API), reinicia los valores
  useEffect(() => {
    setValoresCampos(campos.map(() => ""));
  }, [campos.length]);

  const handleCampoChange = (index, valor) => {
    setValoresCampos((prev) => {
      const copia = [...prev];
      copia[index] = valor;
      return copia;
    });
  };

  const handleConfirmar = () => {
    if (onSubmit) {
      onSubmit({
        area,
        fecha,
        campos: campos.map((label, i) => ({ label, valor: valoresCampos[i] })),
        razon,
      });
    }
  };

  return (
    <div style={{
      background: "#fff",
      border: "2px solid #b8a97a",
      borderRadius: "14px",
      width: "520px",
      overflow: "hidden",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
    }}>
      {/* Header */}
      <div style={{
        background: "#2d6e62",
        display: "flex",
        justifyContent: "center",
        padding: "10px 0",
      }}>
        <span style={{
          color: "#fff",
          fontSize: "15px",
          fontWeight: "500",
          letterSpacing: "1.5px",
          padding: "4px 20px",
          border: "1.5px solid #fff",
          borderRadius: "4px",
        }}>
          TICKET DE SALIDA
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: "16px 24px 20px" }}>

        {/* Título área (dinámico) */}
        <p style={{
          color: "#d4642a",
          fontSize: "22px",
          fontWeight: "500",
          textAlign: "center",
          margin: "0 0 14px",
          minHeight: "32px",
        }}>
          {loadingArea ? (
            <span style={{ color: "#aaa", fontSize: "14px", fontStyle: "italic" }}>
              Cargando área…
            </span>
          ) : (
            `Área: ${area}`
          )}
        </p>

        {/* Fecha */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px" }}>
          <span style={{ fontSize: "14px", fontWeight: "500", color: "#1a1a1a" }}>Fecha:</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            style={{
              border: "none",
              borderBottom: "1.5px solid #bbb",
              outline: "none",
              fontSize: "14px",
              padding: "2px 6px",
              background: "transparent",
              color: "#1a1a1a",
            }}
          />
        </div>

        {/* Grid: campos izquierda + logo/firma derecha */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

          {/* Campos dinámicos */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {campos.map((label, i) => (
              <CampoTicket
                key={i}
                placeholder={label}
                value={valoresCampos[i] ?? ""}
                onChange={(val) => handleCampoChange(i, val)}
              />
            ))}
          </div>

          {/* Logo + firma */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
            <CielitoHomeLogo />
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontSize: "13px", fontWeight: "500", color: "#1a1a1a", marginBottom: "6px" }}>
                Firma responsable:
              </div>
              <div style={{ borderBottom: "1.5px solid #bbb", height: "32px" }} />
            </div>
          </div>
        </div>

        {/* Razón */}
        <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", marginTop: "20px" }}>
          <span style={{ fontSize: "14px", fontWeight: "500", whiteSpace: "nowrap", color: "#1a1a1a", marginTop: "4px" }}>
            Razón:
          </span>
          <input
            type="text"
            value={razon}
            onChange={(e) => setRazon(e.target.value)}
            placeholder=""
            style={{
              flex: 1,
              border: "none",
              borderBottom: "1.5px solid #bbb",
              outline: "none",
              fontSize: "14px",
              background: "transparent",
              color: "#1a1a1a",
              padding: "2px 6px",
            }}
          />
        </div>
        <div style={{ borderBottom: "1.5px solid #bbb", height: "24px", marginTop: "14px" }} />

        {/* Botón confirmar (opcional, solo si onSubmit está definido) */}
        {onSubmit && (
          <button
            onClick={handleConfirmar}
            style={{
              marginTop: "20px",
              width: "100%",
              padding: "10px",
              background: "#2d6e62",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              fontSize: "14px",
              fontWeight: "500",
              cursor: "pointer",
              letterSpacing: "0.5px",
            }}
          >
            Confirmar ticket
          </button>
        )}
      </div>
    </div>
  );
}
