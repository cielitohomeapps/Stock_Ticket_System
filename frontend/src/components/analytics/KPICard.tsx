/**
 * KPI Card Component - displays a single metric with trend indicator
 */

import React from 'react';
import type { KPIData } from '../../types/analytics.types';
import '../styles/analytics.css';

interface KPICardProps {
  data: KPIData;
  icon?: string;
  color?: 'primary' | 'success' | 'warning' | 'danger';
}

/**
 * KPI Card Component
 * Displays a key performance indicator with optional trend information
 */
export const KPICard: React.FC<KPICardProps> = ({ data, icon = '📊', color = 'primary' }) => {
  return (
    <div className={`kpi-card kpi-card--${color}`}>
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-content">
        <div className="kpi-label">{data.label}</div>
        <div className="kpi-value">{data.value.toLocaleString()}</div>
        {data.change !== undefined && (
          <div className={`kpi-change ${data.change >= 0 ? 'positive' : 'negative'}`}>
            {data.change >= 0 ? '↑' : '↓'} {Math.abs(data.changePercent || 0)}%
          </div>
        )}
      </div>
    </div>
  );
};

export default KPICard;
