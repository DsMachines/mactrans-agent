// Client-side SSE stream parser routing events to React state dispatchers

export function routeEvent(event, dispatchers) {
  if (!event || !event.type) return;

  switch(event.type) {
    case 'thinking':
    case 'tool_call':
    case 'tool_response':
      dispatchers.addTerminalLine(event);
      break;
    case 'rate_card':
      dispatchers.setRateCard(event.data);
      break;
    case 'email_draft':
      dispatchers.setEmail(event);
      break;
    case 'whatsapp_msg':
      dispatchers.setWhatsapp(event);
      break;
    case 'negotiation_result':
      dispatchers.setNegotiationResult(event);
      break;
    case 'alternate_offer':
      dispatchers.setAlternateOffer(event);
      break;
    case 'pending_action':
      dispatchers.setPendingApproval(event);
      break;
    case 'done':
      dispatchers.setDone(true);
      break;
    case 'error':
      dispatchers.setError(event.message);
      break;
    default:
      console.warn("Unhandled SSE event type:", event.type, event);
  }
}
