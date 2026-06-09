/**
 * Location Distribution Chart - Donut chart showing movement distribution by location
 */

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { AreaMovement } from '../../types/analytics.types';
import '../styles/analytics.css';

interface AreaDistributionChartProps {
  data: AreaMovement[];
  height?: number;
}

// Color palette for areas
const COLORS = [
  '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#FF6B6B',
  '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F',
];

/**
 * Area Distribution Chart Component
 * Displays movement distribution by area as a donut chart
 */
export const AreaDistributionChart: React.FC<AreaDistributionChartProps> = ({ data, height = 300 }) => {
  const chartData = data.map((item) => ({
    name: item.area,
    value: item.count,
  }));

  const renderCustomLabel = ({ name, percent }: any) => {
    return `${(percent * 100).toFixed(0)}%`;
  };

  return (
    <div className="chart-container">
      <h3>Movement by Location</h3>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            fill="#8884d8"
            paddingAngle={2}
            dataKey="value"
            label={renderCustomLabel}
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => value.toLocaleString()} />
          <Legend layout="vertical" align="right" verticalAlign="middle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AreaDistributionChart;
