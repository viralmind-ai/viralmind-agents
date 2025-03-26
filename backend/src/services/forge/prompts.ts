export const TASK_SHOT_EXAMPLES = [
  {
    task_prompt: 'Find a hotel in Paris',
    app: {
      type: 'website',
      name: 'Booking.com',
      url: 'booking.com'
    },
    conversation: [
      {
        role: 'user',
        content: 'Task: Find a hotel in Paris\nApp: Booking.com (website, URL: booking.com)'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'validate_task_request',
              arguments: JSON.stringify({
                title: 'Find Paris hotel',
                app: 'Booking.com',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=booking.com&sz=64',
                objectives: [
                  'Open <app>Booking.com</app> website in your browser',
                  'Search for Paris hotels',
                  'Apply filters for dates and preferences',
                  'View hotel details and reviews'
                ],
                content:
                  'Hi! I need to find a hotel in Paris for my upcoming trip. Can you help me search on Booking.com?'
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_123',
        content: 'accepted'
      },
      {
        role: 'user',
        content:
          "Sure! I'll help you find a hotel in Paris. Let's start by going to booking.com and entering your travel dates. When are you planning to visit?"
      }
    ]
  },
  {
    task_prompt: 'Order sushi delivery',
    app: {
      type: 'website',
      name: 'Uber Eats',
      url: 'ubereats.com'
    },
    conversation: [
      {
        role: 'user',
        content: 'Task: Order sushi delivery\nApp: Uber Eats (website, URL: ubereats.com)'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_456',
            type: 'function',
            function: {
              name: 'validate_task_request',
              arguments: JSON.stringify({
                title: 'Order sushi delivery',
                app: 'Uber Eats',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=ubereats.com&sz=64',
                objectives: [
                  'Open <app>Uber Eats</app> website in your browser',
                  'Find nearby sushi restaurants',
                  'Select items and customize order',
                  'Review cart before checkout'
                ],
                content:
                  "Hi! I'm hungry and want to order some sushi from Uber Eats. Can you show me how?"
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_456',
        content: 'accepted'
      },
      {
        role: 'user',
        content:
          "I'll help you order sushi through Uber Eats! First, let's check which sushi restaurants deliver to your location. Could you open ubereats.com and enter your delivery address?"
      }
    ]
  },
  {
    task_prompt: 'Find tennis shoes on sale',
    app: {
      type: 'website',
      name: 'eBay',
      url: 'ebay.com'
    },
    conversation: [
      {
        role: 'user',
        content: 'Task: Find tennis shoes on sale\nApp: eBay (website, URL: ebay.com)'
      },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_789',
            type: 'function',
            function: {
              name: 'validate_task_request',
              arguments: JSON.stringify({
                title: 'Find tennis shoes',
                app: 'eBay',
                icon_url: 'https://s2.googleusercontent.com/s2/favicons?domain=ebay.com&sz=64',
                objectives: [
                  'Open <app>eBay</app> website in your browser',
                  'Search for tennis shoes',
                  'Apply filters for size and price',
                  'Sort and compare listings'
                ],
                content:
                  "Hi! I want to buy some tennis shoes on eBay. I've never used the site before - can you help me find a good deal?"
              })
            }
          }
        ]
      },
      {
        role: 'tool',
        tool_call_id: 'call_789',
        content: 'accepted'
      },
      {
        role: 'user',
        content:
          "I'll help you find tennis shoes on eBay! Let's start by going to ebay.com. Do you have a specific brand or size in mind?"
      }
    ]
  }
];

export const SYSTEM_PROMPT = `You are playing the role of someone who needs help with a specific computer task. You should act as a realistic user who is not tech-savvy but friendly and appreciative. Stay in character and express your needs naturally and casually.

Remember to:
- Keep your initial request brief and natural
- Show mild confusion if technical terms are used
- Express appreciation when helped
- Stay focused on your specific task
- Ask for clarification if needed
- When provided context, do a tool call where in the content you must say hi and ask for your task directly (e.g. "Hi! I need to install an ad-blocker in Chrome" rather than "Can you guide me on how to install an ad-blocker?")`;
export const APP_TASK_GENERATION_PROMPT = `
You are designing natural task examples for various websites and apps to train AI assistants in helping users navigate digital services effectively.  

### **Instructions:**  
- Given a list of computer skills, generate **apps and their associated tasks** that naturally incorporate those skills.  
- Use **common digital services** unless a specific app/website is provided.  
- Each app should have at least **5 tasks** representing **real-world user interactions**.  
- Ensure **tasks align with the provided skills** rather than being random generic actions.
- IMPORTANT: Avoid using personal pronouns like "my" or "your" in task descriptions. Use neutral, general language.
- Be as exhaustive as possible, enumerating every relevant app and task given the input skill list.

### **Guidelines for Mapping Skills to Apps:**  

#### **1. Browser Management → Web Browsers (Chrome, Firefox, Edge, Safari, etc.)**
✅ **Examples:** Google Chrome, Mozilla Firefox, Microsoft Edge  
✅ **Tasks:**  
- "Change the default search engine to DuckDuckGo in Chrome."  
- "Restore recently closed tabs in Firefox."  
- "Clear browsing history and cookies in Edge."  
- "Save a webpage as a PDF in Safari."  
- "Install an ad blocker extension in Chrome."  

#### **2. Office Suite → Office Productivity Apps (Microsoft Office, Google Docs, LibreOffice, etc.)**
✅ **Examples:** Microsoft Word, Google Docs, LibreOffice Writer  
✅ **Tasks:**  
- "Format a document with proper headings in Word."  
- "Convert a DOCX file to PDF in Google Docs."  
- "Create a table with merged cells in LibreOffice Writer."  
- "Set up automatic spell check in Word."  
- "Insert a graph from an Excel sheet into a Google Docs file."  

#### **3. Email Client → Email Services (Gmail, Outlook, Thunderbird, etc.)**
✅ **Examples:** Gmail, Microsoft Outlook, Mozilla Thunderbird  
✅ **Tasks:**  
- "Set up an email signature in Outlook."  
- "Create a filter to move newsletters to a specific folder in Gmail."  
- "Export emails from Thunderbird to a backup file."  
- "Redirect incoming emails to a different address in Outlook."  
- "Organize an inbox by creating custom labels in Gmail."  

#### **4. Image Editing → Image Editors (Photoshop, GIMP, Canva, etc.)**
✅ **Examples:** Adobe Photoshop, GIMP, Canva  
✅ **Tasks:**  
- "Batch resize multiple images in Photoshop."  
- "Convert a PNG file to JPG in GIMP."  
- "Apply a vintage filter to a photo in Canva."  
- "Enhance the resolution of a blurry image in Photoshop."  
- "Remove the background from an image in GIMP."  

#### **5. File Operations → File Management Apps (File Explorer, etc.)**
✅ **Examples:** File Explorer, WinRAR  
✅ **Tasks:**  
- "Compress files into a ZIP folder using File Explorer."  
- "Recover a deleted file from the Recycle Bin."  
- "Extract a RAR archive using WinRAR."  
- "Batch rename multiple files in Windows Explorer."  
- "Backup documents to an external hard drive."  

#### **6. Code Editor → Development Environments (VS Code, Sublime Text, JetBrains, etc.)**
✅ **Examples:** Visual Studio Code, Sublime Text, JetBrains IntelliJ IDEA  
✅ **Tasks:**  
- "Install the Python extension in VS Code."  
- "Set up a dark theme in Sublime Text."  
- "Configure workspace settings in JetBrains IntelliJ."  
- "Enable line numbers in Visual Studio Code."  
- "Use keyboard shortcuts to quickly navigate files in Sublime Text."  

### **Output Format (JSON object):**  
Output format should be a JSON object with the following structure:
{
  "name": "Concise Agent Name", // e.g. "Email Manager Agent" instead of "Email Management Task Collection"
  "apps": [
    {
      "name": "App Name",
      "domain": "example.com",
      "description": "Brief service description",
      "categories": ["Category1", "Category2"],
      "tasks": [
        {
          "prompt": "Natural user request"
        }
      ]
    }
  ]
}

Example categories to consider:
- Shopping
- Travel
- Delivery
- Entertainment
- Productivity
- Local Services
- Lifestyle
- News & Media

Focus on creating tasks that feel like genuine user requests, similar to (but avoid personal pronouns):
- "Order dinner for a family of 4"
- "Book a hotel in Paris for next weekend"
- "Find running shoes under $100"
- "Schedule a cleaning service for tomorrow"

<SKILLS>
{skill list}
</SKILLS>

Output only the JSON object with no additional text or explanation.`;
