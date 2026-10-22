/**
 * Gráfica diaria de solicitudes cuyo movimiento fue aplicado
 */

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { DailyVolume } from '../../types/analytics.types';
import '../styles/analytics.css';

interface DailyVolumeChartProps {
  data: DailyVolume[];
  height?: number;
}

/**
 * Muestra el número de movimientos aplicados por día, separado entre salidas y entradas.
 */
export const DailyVolumeChart: React.FC<DailyVolumeChartProps> = ({ data, height = 300 }) => {
  // Format data for display - show only every nth day if too many points
  const step = data.length > 14 ? Math.ceil(data.length / 14) : 1;
  const displayData = data.filter((_, i) => i % step === 0 || i === data.length - 1);
  const hasMovements = data.some((point) => point.totalCount > 0);

  return (
    <div className="chart-container">
      <h3>Solicitudes con movimiento aplicado por día</h3>
      {!hasMovements ? (
        <div className="analytics-empty-state">No hay movimientos aplicados en este periodo.</div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={displayData} margin={{ top: 20, right: 30, left: 0, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(value) => new Date(`${String(value)}T00:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })}
              angle={-45}
              textAnchor="end"
              height={80}
              tick={{ fontSize: 12 }}
            />
            <YAxis />
            <Tooltip
              formatter={(value) => Number(value).toLocaleString('es-MX')}
              labelFormatter={(label) => `Fecha: ${new Date(`${String(label)}T00:00:00`).toLocaleDateString('es-MX')}`}
            />
            <Legend />
            <Bar dataKey="exitCount" fill="#dc3545" name="Salidas" />
            <Bar dataKey="entryCount" fill="#28a745" name="Entradas" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

export default DailyVolumeChart;
