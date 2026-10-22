import React from 'react'

export function getAlertDetails(error, context = 'general') {
  const message = typeof error === 'string' ? error : error?.message || ''
  const code = error?.code
  const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

  if (error instanceof TypeError) {
    return {
      title: 'No se pudo conectar con el sistema',
      message: 'Revisa tu conexión e inténtalo de nuevo. Si el problema continúa, contacta al administrador.',
    }
  }

  if (code === 'INSUFFICIENT_STOCK' || normalized.includes('stock insuficiente')) {
    return {
      title: 'Stock insuficiente',
      message: `${message} Reduce la cantidad solicitada o revisa el stock disponible antes de volver a enviar.`,
    }
  }

  if (
    code === 'INVENTORY_UNAVAILABLE' ||
    code === 'INVALID_INVENTORY_RESPONSE' ||
    (context === 'inventory' && code === 'API_UNAVAILABLE') ||
    (context === 'inventory' && (error?.status === 502 || error?.status === 503)) ||
    normalized.includes('timeout invocando api externa')
  ) {
    return {
      title: 'Sistema de inventarios no disponible',
      message: 'No se pudo consultar el inventario. Revisa que el sistema de inventarios esté activo y vuelve a intentarlo. No se envió el ticket.',
    }
  }

  if (code === 'API_UNAVAILABLE') {
    return {
      title: 'No se pudo conectar con el sistema',
      message: 'Revisa tu conexión. Si el problema continúa, inténtalo más tarde o contacta al administrador.',
    }
  }

  if (context === 'inventory') {
    return {
      title: 'No se pudieron cargar los datos del inventario',
      message: message || 'Inténtalo de nuevo. Si el problema continúa, revisa que el sistema de inventarios esté activo.',
    }
  }

  return {
    title: 'No se pudo completar la operación',
    message: message || 'Revisa los datos e inténtalo de nuevo.',
  }
}

export default function AlertBanner({
  title,
  message,
  onRetry,
  retryLabel,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
}) {
  return (
    <div className={`alert-banner ${className}`.trim()} role="alert" aria-live="assertive">
      <span className="alert-banner-icon" aria-hidden="true">!</span>
      <div className="alert-banner-content">
        <strong className="alert-banner-title">{title}</strong>
        <p className="alert-banner-message">{message}</p>
        {onRetry && (
          <button type="button" className="alert-banner-retry" onClick={onRetry}>
            {retryLabel || 'Intentar de nuevo'}
          </button>
        )}
        {onSecondaryAction && (
          <button type="button" className="alert-banner-retry" onClick={onSecondaryAction}>
            {secondaryActionLabel || 'Continuar'}
          </button>
        )}
      </div>
    </div>
  )
}
