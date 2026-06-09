/**
 * Daily Volume Chart - Bar chart showing EXIT vs ENTRY volumes over time
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
 * Daily Volume Chart Component
 * Displays daily movement volume with EXIT (red) and ENTRY (green) breakdown
 */
export const DailyVolumeChart: React.FC<DailyVolumeChartProps> = ({ data, height = 300 }) => {
  // Format data for display - show only every nth day if too many points
  const step = data.length > 14 ? Math.ceil(data.length / 14) : 1;
  const displayData = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  return (
    <div className="chart-container">
      <h3>Daily Movement Volume</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={displayData} margin={{ top: 20, right: 30, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            angle={-45}
            textAnchor="end"
            height={80}
            tick={{ fontSize: 12 }}
          />
          <YAxis />
          <Tooltip
            formatter={(value) => value.toLocaleString()}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Legend />
          <Bar dataKey="exitCount" fill="#dc3545" name="EXIT" />
          <Bar dataKey="entryCount" fill="#28a745" name="ENTRY" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default DailyVolumeChart;
