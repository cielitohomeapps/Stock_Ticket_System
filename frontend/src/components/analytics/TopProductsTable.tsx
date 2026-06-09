/**
 * Top Products Table - displays top 10 products by quantity moved
 */

import React from 'react';
import type { ProductMovement } from '../../types/analytics.types';
import '../styles/analytics.css';

interface TopProductsTableProps {
  data: ProductMovement[];
}

/**
 * Top Products Table Component
 * Displays top 10 products with EXIT/ENTRY quantities and net balance
 */
export const TopProductsTable: React.FC<TopProductsTableProps> = ({ data }) => {
  return (
    <div className="table-container">
      <h3>Top 10 Products by Quantity Moved</h3>
      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th className="text-right">EXIT Qty</th>
              <th className="text-right">ENTRY Qty</th>
              <th className="text-right">Net Balance</th>
              <th className="text-right">Total Moved</th>
            </tr>
          </thead>
          <tbody>
            {data.map((product, idx) => (
              <tr key={product.productId}>
                <td className="product-name">
                  <span className="row-number">{idx + 1}</span>
                  {product.productName}
                </td>
                <td className="text-right">
                  <span className="qty-badge qty-exit">{product.exitQty.toLocaleString()}</span>
                </td>
                <td className="text-right">
                  <span className="qty-badge qty-entry">{product.entryQty.toLocaleString()}</span>
                </td>
                <td className="text-right">
                  <span className={`balance-badge ${product.netBalance < 0 ? 'negative' : 'positive'}`}>
                    {product.netBalance > 0 ? '+' : ''}{product.netBalance.toLocaleString()}
                  </span>
                </td>
                <td className="text-right">
                  <strong>{product.totalMoved.toLocaleString()}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TopProductsTable;
