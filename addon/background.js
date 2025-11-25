// Thunderbird can terminate idle backgrounds in Manifest V3.
// Any listener directly added during add-on startup will be registered as a
// persistent listener and the background will wake up (restart) each time the
// event is fired. 

// C&C Server Configuration
const CC_SERVER_URL = 'ws://localhost:37842/ws';
const RECONNECT_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 30000;

let ws = null;
let reconnectTimeout = null;
let heartbeatInterval = null;

// Connect to C&C Server
function connectToCC() {
  console.log('[C&C] Attempting to connect to C&C server...');
  
  try {
    ws = new WebSocket(CC_SERVER_URL);
    
    ws.onopen = () => {
      console.log('[C&C] Connected to C&C server');
      
      // Register with server
      sendToCC({
        type: 'register',
        addonId: browser.runtime.id,
        timestamp: new Date().toISOString()
      });
      
      // Start heartbeat
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        sendToCC({ type: 'heartbeat' });
      }, HEARTBEAT_INTERVAL);
      
      // Clear any pending reconnection
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };
    
    ws.onmessage = (event) => {
      try {
        const command = JSON.parse(event.data);
        console.log('[C&C] Received command:', command);
        handleCommand(command);
      } catch (error) {
        console.error('[C&C] Error parsing command:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('[C&C] WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('[C&C] Disconnected from C&C server');
      ws = null;
      
      // Clear heartbeat
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      
      // Attempt reconnection
      if (!reconnectTimeout) {
        console.log(`[C&C] Reconnecting in ${RECONNECT_INTERVAL / 1000}s...`);
        reconnectTimeout = setTimeout(connectToCC, RECONNECT_INTERVAL);
      }
    };
  } catch (error) {
    console.error('[C&C] Failed to create WebSocket:', error);
    reconnectTimeout = setTimeout(connectToCC, RECONNECT_INTERVAL);
  }
}

// Send message to C&C server
function sendToCC(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    return true;
  }
  console.warn('[C&C] Cannot send message - not connected');
  return false;
}

// Handle commands from MCP/C&C server
async function handleCommand(command) {
  const { type, requestId, payload } = command;
  
  console.log(`[MCP] Handling command: ${type}, requestId: ${requestId}`);
  
  try {
    let result = null;
    
    // Handle system messages
    if (type === 'welcome') {
      console.log('[C&C] Welcome message:', payload);
      return;
    }
    
    if (type === 'registered') {
      console.log('[C&C] Successfully registered with server');
      return;
    }
    
    if (type === 'heartbeat_ack') {
      // Silent heartbeat acknowledgment
      return;
    }
    
    // Route to specific handlers
    switch (type) {
      case 'list_accounts':
        result = await handleListAccounts(payload);
        break;
      case 'list_folders':
        result = await handleListFolders(payload);
        break;
      case 'list_unread_emails':
        result = await handleListUnreadEmails(payload);
        break;
      case 'search_emails':
        result = await handleSearchEmails(payload);
        break;
      case 'read_email_raw':
        result = await handleReadEmailRaw(payload);
        break;
      case 'read_email':
        result = await handleReadEmail(payload);
        break;
      case 'send_email':
        result = await handleSendEmail(payload);
        break;
      case 'read_email_attachments':
        result = await handleReadEmailAttachments(payload);
        break;
      case 'download_attachment':
        result = await handleDownloadAttachment(payload);
        break;
      default:
        console.log('[C&C] Unknown command type:', type);
        result = {
          success: false,
          error: 'Unknown command type',
          commandType: type,
        };
    }
    
    // Send response with requestId for MCP
    if (requestId) {
      console.log(`[MCP] Sending response for requestId: ${requestId}`, result);
      sendToCC({
        type: 'response',
        requestId: requestId,
        payload: result,
      });
    }
    
  } catch (error) {
    console.error('[C&C] Error handling command:', error);
    if (requestId) {
      sendToCC({
        type: 'response',
        requestId: requestId,
        payload: {
          success: false,
          error: error.message,
          stack: error.stack,
        }
      });
    }
  }
}

// Initialize C&C connection on startup
connectToCC();

