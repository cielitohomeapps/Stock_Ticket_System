/**
 * Products By Location Widget
 */

import React, { useState, useMemo } from 'react';
import type { ProductMovement } from '../../types/analytics.types';
import '../styles/analytics.css';

interface ProductsByLocationWidgetProps {
  productsByLocation: Record<string, ProductMovement[]>;
}

export const ProductsByLocationWidget: React.FC<ProductsByLocationWidgetProps> = ({ productsByLocation }) => {
  const locations = useMemo(() => Object.keys(productsByLocation).sort(), [productsByLocation]);
  const [selectedLocation, setSelectedLocation] = useState<string>(locations[0] || '');

  // Update selected location if it's no longer valid
  React.useEffect(() => {
    if (locations.length > 0 && !locations.includes(selectedLocation)) {
      setSelectedLocation(locations[0]);
    } else if (locations.length === 0) {
      setSelectedLocation('');
    }
  }, [locations, selectedLocation]);

  const currentProducts = selectedLocation ? productsByLocation[selectedLocation] || [] : [];

  return (
    <div className="table-container" style={{ gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3>Productos Llevados por Ubicación</h3>
        <select
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
          className="filter-select"
          style={{ width: '250px' }}
        >
          {locations.length === 0 && <option value="">No hay ubicaciones</option>}
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrapper">
        <table className="analytics-table">
          <thead>
            <tr>
              <th>Producto</th>
              <th className="text-right">Enviados (EXIT)</th>
              <th className="text-right">Recibidos (ENTRY)</th>
              <th className="text-right">Total Movido</th>
            </tr>
          </thead>
          <tbody>
            {currentProducts.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center" style={{ padding: '20px', color: '#666' }}>
                  No hay productos registrados para esta ubicación
                </td>
              </tr>
            ) : (
              currentProducts.map((product, idx) => (
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
                    <strong>{product.totalMoved.toLocaleString()}</strong>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProductsByLocationWidget;
