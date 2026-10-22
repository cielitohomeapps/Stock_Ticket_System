/**
 * Tabla de productos con mayor cantidad movida
 */

import React from 'react';
import type { ProductMovement } from '../../types/analytics.types';
import '../styles/analytics.css';

interface TopProductsTableProps {
  data: ProductMovement[];
}

/**
 * Muestra los diez productos con mayor cantidad en movimientos aplicados.
 */
export const TopProductsTable: React.FC<TopProductsTableProps> = ({ data }) => {
  return (
    <div className="table-container">
      <h3>10 productos con más unidades movidas</h3>
      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="text-right">Unidades de salida</th>
              <th className="text-right">Unidades de entrada</th>
              <th className="text-right">Balance neto</th>
              <th className="text-right">Total movido</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-muted py-4">
                  No hay movimientos aplicados en este periodo.
                </td>
              </tr>
            ) : data.map((product, idx) => (
              <tr key={product.productId}>
                <td className="product-name">
                  <span className="row-number">{idx + 1}</span>
                  {product.productName}
                </td>
                <td className="text-right">
                  <span className="qty-badge qty-exit">{product.exitQty.toLocaleString('es-MX')}</span>
                </td>
                <td className="text-right">
                  <span className="qty-badge qty-entry">{product.entryQty.toLocaleString('es-MX')}</span>
                </td>
                <td className="text-right">
                  <span className={`balance-badge ${product.netBalance < 0 ? 'negative' : 'positive'}`}>
                    {product.netBalance > 0 ? '+' : ''}{product.netBalance.toLocaleString('es-MX')}
                  </span>
                </td>
                <td className="text-right">
                  <strong>{product.totalMoved.toLocaleString('es-MX')}</strong>
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
