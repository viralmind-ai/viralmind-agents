import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
dotenv.config();
import { LLMService } from '../services/llm/index.ts';
import BlockchainService from '../services/blockchain/index.ts';
import DatabaseService from '../services/db/index.ts';
import VNCService from '../services/vnc/index.ts';

import { executeComputerAction } from '../services/vnc/actions.ts';
import TournamentService from '../services/tournament/index.ts';
import MessageFilters from '../services/tournament/filters.ts';
import ConversationService from '../services/conversation/index.ts';
import { DBChat, GenericModelMessage } from '../types/index.ts';

const router = express.Router();

// Handle Message Submission
router.post('/submit/:id', async (req: Request, res: Response) => {
  try {
    let { prompt, signature, walletAddress } = req.body as {
      prompt: string;
      signature: string;
      walletAddress: string;
    };
    const { id } = req.params;

    // validate req data
    if (!prompt || !signature || !walletAddress) {
      res.write('Missing required fields');
      return;
    }
    // make sure this message txn hasn't been sent already
    if (
      await DatabaseService.findOneChat({
        txn: signature
      })
    ) {
      res.write('Duplicate signature');
      return;
    }

    const challenge = await DatabaseService.getChallengeById(id);
    if (!challenge) throw Error('Error getting challenge from database.');
    const challengeName = challenge.name;
    // validate challenge + chain status
    await TournamentService.validateChallenge(challenge);

    // validate tournament program + transaction
    const tournamentPDA = challenge.tournamentPDA!;
    const blockchain = new BlockchainService(process.env.RPC_URL!, challenge.idl?.address!);
    const tournament = await blockchain.getTournamentData(tournamentPDA);
    if (!tournament) {
      res.write('Tournament data not found');
      return;
    }
    const entryFee = tournament.entryFee;
    if (!entryFee) {
      res.write('Entry fee not found in tournament data');
      return;
    }
    const isValidTransaction = await blockchain.verifyTransaction(
      signature,
      tournamentPDA,
      entryFee,
      walletAddress
    );

    // update db w/ new entry fee
    const now = new Date();
    const oneHourInMillis = 3600000;
    await DatabaseService.updateChallenge(id, {
      entryFee: entryFee,
      ...(challenge.expiry!.getTime() - now.getTime() < oneHourInMillis && {
        expiry: new Date(now.getTime() + oneHourInMillis)
      })
    });

    // if the agent exists within a game then:
    if (challenge.game) {
      // invalid tx
      if (!isValidTransaction) {
        res.end();
        return;
      }

      // Create and save user message
      await DatabaseService.createChat({
        challenge: challengeName!,
        role: 'user',
        content: prompt,
        address: walletAddress,
        txn: signature,
        date: new Date()
      });

      // End response immediately
      res.end();
      return;
    }

    // capture screenshot from VNC session
    const screenshot = await VNCService.getScreenshot(tournamentPDA, true);

    // apply tournament prompt filters
    prompt = MessageFilters.applyFilters(prompt, {
      disable: challenge.disable,
      characterLimit: challenge.characterLimit!,
      charactersPerWord: challenge.charactersPerWord!
    });

    const model = challenge.model || 'claude-3-5-sonnet-20241022';
    const format: 'anthropic' | 'openai' = model.startsWith('gpt') ? 'openai' : 'anthropic';
    let systemPrompt = challenge.system_message;

    // construct LLM context
    let messages: GenericModelMessage[] = [{ role: 'system', content: systemPrompt || '' }];
    // process chat history if contextLimit > 1
    const contextLimit = challenge.contextLimit || 1;
    if (contextLimit > 1) {
      const chatHistory = await DatabaseService.getChatHistory(
        {
          challenge: challengeName,
          address: walletAddress
        },
        { date: -1 },
        contextLimit - 1
      );
      if (!chatHistory) throw Error('Error getting chat history.');
      for (const chat of chatHistory.reverse()) {
        if (chat.role === 'user') {
          messages.push({
            role: 'user',
            content: chat.content || 'empty'
          });
        } else if (chat.role === 'assistant') {
          messages.push(...ConversationService.extractToolCalls(chat.content, format));
        }
      }
    }
    // add user message
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        (await ConversationService.createImageContent(screenshot, format)) ?? {
          type: 'image',
          text: ''
        }
      ]
    });

    // create message entry
    const userMessage: DBChat = {
      challenge: challengeName!,
      model: model,

      // message
      role: 'user',
      content: prompt,
      screenshot: screenshot,

      // user data
      address: walletAddress,
      txn: signature,
      verified: isValidTransaction,
      date: now
    };
    await DatabaseService.createChat(userMessage);

    // initialize assistant entry
    const assistantMessage: DBChat = {
      challenge: challengeName!,
      model: model,
      role: 'assistant',
      content: '',
      tool_calls: undefined,
      address: walletAddress,
      date: new Date(),
      screenshot: screenshot
    };

    // prepare to stream response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // write initial message
    res.write(
      JSON.stringify({
        content: '',
        screenshot: screenshot
      })
    );

    // agentic loop
    // 1. stream response, returns true if tool call
    async function streamResponse() {
      const llm = new LLMService(model);
      const stream = await llm.createChatCompletion(messages);

      if (!stream) return false;

      for await (const chunk of stream) {
        const { type } = chunk;
        // stream + accumulate content chunks
        if (type == 'text_delta') {
          assistantMessage.content += chunk.delta;
          res.write(chunk.delta);
          res.flushHeaders();
        }

        if (type == 'tool_call') {
          const toolCall = chunk.function;

          // execute tool call
          try {
            if (toolCall?.name === 'computer') {
              // validate tool call
              if (!toolCall.arguments) throw new Error('Incomplete tool call arguments received');
              let args = JSON.parse(toolCall.arguments);
              if (!args || !args.action)
                throw new Error('Missing required fields in tool call arguments');

              const client = await VNCService.ensureValidConnection(tournamentPDA);
              if (client) {
                // log and execute action
                await TournamentService.makeAttempt(walletAddress);
                const actionText = await executeComputerAction(args.action, args, client);

                // stream action + accumulate action string
                if (actionText) {
                  assistantMessage.content += '\n' + actionText + '\n';
                  res.write('\n' + actionText + '\n');
                  res.flushHeaders();
                }
              } else throw new Error('No VNC client available for computer actions');
            } else {
              throw new Error(`Invalid tool call name ${toolCall?.name}`);
            }
          } catch (tool_er) {
            messages.push({
              role: 'user',
              content: `Error during attempted tool call: ${tool_er}`
            });
            throw tool_er;
          }

          return true;
        } else if (type == 'stop') {
          return false;
        } else if (type == 'error') {
          throw new Error(chunk.message);
        }
      }

      console.log('end of stream!');

      return false;
    }

    const maxActions = challenge.max_actions || 3;
    let numActions = 0;
    let retryCount = 0;
    const maxRetries = 5;
    const baseDelay = 5000; // Start with 5 second
    const maxDelay = 60000; // Cap at 60 seconds

    while (true) {
      assistantMessage.content = '';
      try {
        const running = await streamResponse();
        console.log(running);
        console.log(assistantMessage);

        // push assistant message to db
        const latestFrame = await VNCService.getScreenshot(tournamentPDA, true);
        if (latestFrame) assistantMessage.screenshot = latestFrame;
        assistantMessage.date = new Date();
        if (assistantMessage.content) await DatabaseService.createChat(assistantMessage);
        else {
          console.log('message with no content');
          console.log(assistantMessage);
        }

        if (!running) break; // agent is done

        numActions += 1;
        messages = [
          ...messages,
          ...ConversationService.extractToolCalls(
            assistantMessage.content,
            format,
            await ConversationService.createImageContent(latestFrame, format) // follow w/ tool call response
          )
        ];

        if (numActions > maxActions) break; // success, exit loop
        // continue looping until we reach max actions...
      } catch (e) {
        console.error(`Error handling submit (${retryCount}/${maxRetries}):`, e);

        retryCount++;
        if (retryCount >= maxRetries) {
          // reaching this point should be highly unlikely, but if it occurs lets broadcast that information
          res.write(`Error: Maximum retry attempts (${maxRetries}) reached. Failing.`);
          assistantMessage.content += `Error: Maximum retry attempts (${maxRetries}) reached. Failing.`;
          assistantMessage.date = new Date();
          await DatabaseService.createChat(assistantMessage);
        }

        // Calculate delay with exponential backoff (2^n * baseDelay), capped at maxDelay
        const delay = Math.min(Math.pow(2, retryCount) * baseDelay, maxDelay);
        res.write(
          `Error: ${e}. Retrying in ${
            delay / 1000
          } seconds... (Attempt ${retryCount}/${maxRetries})`
        );

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));
        // continue looping until we reach max actions...
      }
    }

    // Check and cache tournament scores if challenge uses score-based expiry
    if (challenge.expiry_logic === 'score') {
      try {
        const scores = await TournamentService.checkScores();
        if (scores) {
          await DatabaseService.updateChallenge(id, {
            scores: scores.map((score) => ({
              account: score.account,
              address: score.address,
              score: score.score,
              timestamp: new Date()
            }))
          });
        }
      } catch (scoreError) {
        console.error('Error updating tournament scores:', scoreError);
      }
    }

    res.end();
  } catch (error) {
    console.error('Error handling submit:', error);
    res.write((error as Error).message || 'Server error');
    return;
  }
});

export { router as conversationRoute };
