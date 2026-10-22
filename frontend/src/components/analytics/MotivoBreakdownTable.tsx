/**
 * Tabla de motivos de movimientos aplicados
 */

import React from 'react';
import type { MotivoBreakdown } from '../../types/analytics.types';
import '../styles/analytics.css';

interface MotivoBreakdownTableProps {
  data: MotivoBreakdown[];
}

/**
 * Muestra la distribución de motivos en movimientos confirmados.
 */
export const MotivoBreakdownTable: React.FC<MotivoBreakdownTableProps> = ({ data }) => {
  return (
    <div className="table-container">
      <h3>Movimientos aplicados por motivo</h3>
      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Motivo</th>
              <th className="text-right">Movimientos</th>
              <th className="text-right">Porcentaje</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={3} className="text-center text-muted py-4">
                  No hay movimientos aplicados en este periodo.
                </td>
              </tr>
            ) : data.map((item, idx) => (
              <tr key={item.motivo}>
                <td>
                  <span className="row-number">{idx + 1}</span>
                  {item.motivo}
                </td>
                <td className="text-right">
                  <span className="count-badge">{item.count.toLocaleString('es-MX')}</span>
                </td>
                <td className="text-right">
                  <div className="percentage-bar">
                    <div
                      className="percentage-fill"
                      style={{ width: `${item.percentage}%` }}
                    />
                    <span className="percentage-text">{item.percentage}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MotivoBreakdownTable;
