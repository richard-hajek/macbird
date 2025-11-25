// Command handlers - extracted from background.js

// Helper function to get all folders recursively for an account
async function getAllFoldersForAccount(accountId) {
  const folders = [];
  
  async function traverse(folderId, includeSubFolders = true) {
    try {
      const folder = await browser.folders.get(folderId);
      folders.push(folder);
      
      if (includeSubFolders) {
        // Get subfolders by ID
        const subFolders = await browser.folders.getSubFolders(folderId, false);
        for (const subfolder of subFolders) {
          await traverse(subfolder.id, true);
        }
      }
    } catch (error) {
      console.error(`Error accessing folder ${folderId}:`, error);
    }
  }
  
  // Get root folders for account
  const account = await browser.accounts.get(accountId);
  if (account.rootFolder && account.rootFolder.id) {
    const rootFolders = await browser.folders.getSubFolders(account.rootFolder.id, false);
    for (const folder of rootFolders) {
      await traverse(folder.id, true);
    }
  }
  
  return folders;
}

async function handleListAccounts(_payload) {
  const accounts = await browser.accounts.list();
  return {
    success: true,
    accounts: accounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      type: acc.type,
      identities: acc.identities.map(id => ({
        id: id.id,
        email: id.email,
        name: id.name
      }))
    })),
    count: accounts.length
  };
}

async function handleListFolders(payload) {
  const { accountId } = payload || {};
  const folders = [];
  
  const accounts = accountId 
    ? [await browser.accounts.get(accountId)]
    : await browser.accounts.list();
  
  for (const account of accounts) {
    const accountFolders = await getAllFoldersForAccount(account.id);
    for (const folder of accountFolders) {
      folders.push({
        ...folder,
        accountId: account.id,
        accountName: account.name
      });
    }
  }
  
  return {
    success: true,
    folders: folders,
    count: folders.length
  };
}

async function handleListUnreadEmails(payload) {
  const { accountId, folderId, limit = 50, includeSpam = false, afterDate } = payload || {};
  const messages = [];
  
  // Parse afterDate if provided
  const afterTimestamp = afterDate ? new Date(afterDate).getTime() : null;
  
  // Get accounts to search
  const accounts = accountId 
    ? [await browser.accounts.get(accountId)]
    : await browser.accounts.list();
  
  for (const account of accounts) {
    let folders;
    
    if (folderId) {
      // Get specific folder
      folders = [await browser.folders.get(folderId)];
    } else {
      // Get all folders for the account
      folders = await getAllFoldersForAccount(account.id);
    }
      
    for (const folder of folders) {
      // Skip spam/junk/newsletter folders unless includeSpam is true
      if (!includeSpam) {
        const isSpamFolder = folder.type === 'junk' || 
                             folder.name.toLowerCase() === 'spam' ||
                             folder.name.toLowerCase() === 'junk' ||
                             folder.name.toLowerCase() === 'newsletters' ||
                             folder.path.toLowerCase().includes('/spam') ||
                             folder.path.toLowerCase().includes('/junk') ||
                             folder.path.toLowerCase().includes('/newsletters') ||
                             (folder.specialUse && folder.specialUse.includes('junk'));
        
        if (isSpamFolder) {
          continue;
        }
      }
      
      try {
        const page = await browser.messages.list(folder.id);
        for (const message of page.messages) {
          if (!message.read) {
            // Filter by date if afterDate is provided
            if (afterTimestamp) {
              const messageTimestamp = new Date(message.date).getTime();
              if (messageTimestamp <= afterTimestamp) {
                continue;
              }
            }
            
            messages.push(message);
            if (messages.length >= limit) break;
          }
        }
        if (messages.length >= limit) break;
      } catch (error) {
        console.error(`Error listing messages in folder ${folder.id}:`, error);
      }
    }
    if (messages.length >= limit) break;
  }
  
  return { success: true, messages, count: messages.length };
}

async function handleSearchEmails(payload) {
  const { query, from, to, subject, unread, flagged, limit = 50 } = payload || {};
  
  try {
    // Build search query
    const searchQuery = {
      author: from,
      recipients: to,
      subject: subject,
      body: query,
      unread: unread,
      flagged: flagged,
    };
    
    // Remove undefined values
    Object.keys(searchQuery).forEach(key => searchQuery[key] === undefined && delete searchQuery[key]);
    
    console.log('[MCP] Searching with query:', searchQuery);
    
    // Add timeout wrapper
    const searchTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Search timed out after 25 seconds')), 25000)
    );
    
    const searchPromise = browser.messages.query(searchQuery);
    
    const messages = await Promise.race([searchPromise, searchTimeout]);
    
    console.log('[MCP] Found messages:', messages.messages ? messages.messages.length : 0);
    
    return { 
      success: true, 
      messages: messages.messages ? messages.messages.slice(0, limit) : [],
      count: messages.messages ? messages.messages.length : 0
    };
  } catch (error) {
    console.error('[MCP] Search error:', error);
    return {
      success: false,
      error: error.message,
      hint: 'Try being more specific with your search query, or use list_unread_emails instead',
      stack: error.stack
    };
  }
}

async function handleReadEmailRaw(payload) {
  const { messageId, markAsRead = false } = payload || {};
  
  const message = await browser.messages.get(messageId);
  const full = await browser.messages.getFull(messageId);
  
  if (markAsRead && !message.read) {
    await browser.messages.update(messageId, { read: true });
  }
  
  return {
    success: true,
    message: {
      ...message,
      fullContent: full,
    }
  };
}

async function handleReadEmail(payload) {
  const { messageId, markAsRead = false } = payload || {};
  
  const message = await browser.messages.get(messageId);
  const full = await browser.messages.getFull(messageId);
  
  if (markAsRead && !message.read) {
    await browser.messages.update(messageId, { read: true });
  }
  
  // Extract body content (HTML or plain text)
  let bodyContent = '';
  let isHtml = false;
  
  function extractTextFromPart(part) {
    if (part.contentType && part.contentType.startsWith('text/plain') && part.body) {
      return { text: part.body, html: false };
    }
    if (part.contentType && part.contentType.startsWith('text/html') && part.body) {
      return { text: part.body, html: true };
    }
    if (part.parts) {
      for (const subpart of part.parts) {
        const extracted = extractTextFromPart(subpart);
        if (extracted) return extracted;
      }
    }
    return null;
  }
  
  const extracted = extractTextFromPart(full);
  if (extracted) {
    bodyContent = extracted.text;
    isHtml = extracted.html;
  }
  
  // Build important headers only - server will convert HTML to markdown
  return {
    success: true,
    message: {
      id: message.id,
      date: message.date,
      subject: message.subject,
      from: message.author,
      to: message.recipients,
      cc: message.ccList,
      body: bodyContent,
      isHtml: isHtml,
      read: markAsRead ? true : message.read,
      flagged: message.flagged,
    }
  };
}

async function handleSendEmail(payload) {
  const { to, cc, bcc, subject, body, isHtml = false, accountId } = payload || {};
  
  // Get default identity
  const accounts = await browser.accounts.list();
  const account = accountId 
    ? await browser.accounts.get(accountId)
    : accounts[0];
  
  const identity = account.identities[0];
  
  // Create compose details
  const composeDetails = {
    to: to,
    cc: cc,
    bcc: bcc,
    subject: subject,
    body: body,
    isPlainText: !isHtml,
    identityId: identity.id,
  };
  
  // Create and send
  const tab = await browser.compose.beginNew(composeDetails);
  await browser.compose.sendMessage(tab.id);
  
  return {
    success: true,
    message: 'Email sent successfully',
    sentTo: to,
  };
}

async function handleReadEmailAttachments(payload) {
  const { messageId } = payload || {};
  
  // List all attachments
  const attachments = await browser.messages.listAttachments(messageId);
  
  if (attachments.length === 0) {
    return {
      success: true,
      message: 'No attachments found',
      attachments: [],
    };
  }
  
  const attachmentData = [];
  
  for (const attachment of attachments) {
    try {
      // Get attachment as File
      const file = await browser.messages.getAttachmentFile(messageId, attachment.partName);
      
      // Convert to base64
      const reader = new FileReader();
      const base64Data = await new Promise((resolve, reject) => {
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      
      attachmentData.push({
        filename: attachment.name,
        data: base64Data,
        contentType: attachment.contentType,
        size: attachment.size,
      });
    } catch (error) {
      console.error(`Error downloading attachment ${attachment.name}:`, error);
    }
  }
  
  return {
    success: true,
    attachments: attachmentData,
    count: attachmentData.length,
  };
}

async function handleDownloadAttachment(payload) {
  const { messageId, partName } = payload || {};
  
  // Find the attachment
  const attachments = await browser.messages.listAttachments(messageId);
  const attachment = attachments.find(att => att.partName === partName || att.name === partName);
  
  if (!attachment) {
    return {
      success: false,
      error: 'Attachment not found',
    };
  }
  
  // Get attachment as File
  const file = await browser.messages.getAttachmentFile(messageId, attachment.partName);
  
  // Convert to base64
  const reader = new FileReader();
  const base64Data = await new Promise((resolve, reject) => {
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  
  return {
    success: true,
    filename: attachment.name,
    data: base64Data,
    contentType: attachment.contentType,
    size: attachment.size,
  };
}
