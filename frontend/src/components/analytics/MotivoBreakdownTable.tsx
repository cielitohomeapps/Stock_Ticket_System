/**
 * Movement Reasons Table - displays breakdown by motivo (reason)
 */

import React from 'react';
import type { MotivoBreakdown } from '../../types/analytics.types';
import '../styles/analytics.css';

interface MotivoBreakdownTableProps {
  data: MotivoBreakdown[];
}

/**
 * Motivo Breakdown Table Component
 * Displays movement reasons with count and percentage distribution
 */
export const MotivoBreakdownTable: React.FC<MotivoBreakdownTableProps> = ({ data }) => {
  return (
    <div className="table-container">
      <h3>Movement Reasons Breakdown</h3>
      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Reason (Motivo)</th>
              <th className="text-right">Count</th>
              <th className="text-right">Percentage</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, idx) => (
              <tr key={item.motivo}>
                <td>
                  <span className="row-number">{idx + 1}</span>
                  {item.motivo}
                </td>
                <td className="text-right">
                  <span className="count-badge">{item.count.toLocaleString()}</span>
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
