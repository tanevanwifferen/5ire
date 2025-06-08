/* eslint-disable jsx-a11y/anchor-has-content */
/* eslint-disable react/no-danger */
import Debug from 'debug';
import useChatStore from 'stores/useChatStore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useMarkdown from 'hooks/useMarkdown';
import { IChatMessage } from 'intellichat/types';
import { useTranslation } from 'react-i18next';
import { Divider } from '@fluentui/react-components';
import useKnowledgeStore from 'stores/useKnowledgeStore';
import useToast from 'hooks/useToast';
import ToolSpinner from 'renderer/components/ToolSpinner';
import {
  ChevronDown16Regular,
  ChevronUp16Regular,
} from '@fluentui/react-icons';
import useECharts from 'hooks/useECharts';
import {
  getNormalContent,
  getReasoningContent,
  highlight,
} from '../../../utils/util';
import MessageToolbar from './MessageToolbar';
import useMermaid from '../../../hooks/useMermaid';

const debug = Debug('5ire:pages:chat:Message');

export default function Message({ message }: { message: IChatMessage }) {
  const { t } = useTranslation();
  const { notifyInfo } = useToast();
  const keywords = useChatStore((state: any) => state.keywords);
  const states = useChatStore().getCurState();
  const { showCitation } = useKnowledgeStore();
  const { renderMermaid } = useMermaid();
  const { initECharts, disposeECharts } = useECharts({ message });
  const [deferredReply, setDeferredReply] = useState('');
  const [deferredReasoning, setDeferredReasoning] = useState('');

  const keyword = useMemo(
    () => keywords[message.chatId],
    [keywords, message.chatId],
  );
  const citedFiles = useMemo(
    () => JSON.parse(message.citedFiles || '[]'),
    [message.citedFiles],
  );

  const citedChunks = useMemo(() => {
    return JSON.parse(message.citedChunks || '[]');
  }, [message.citedChunks]);

  const { render } = useMarkdown();

  const onCitationClick = useCallback(
    (event: any) => {
      try {
        // 确保有 href
        if (!event.target?.href) {
          event.preventDefault();
          return;
        }

        const url = new URL(event.target.href);
        if (url.pathname === '/citation' || url.protocol.startsWith('file:')) {
          event.preventDefault();
          const chunkId = url.hash.replace('#', '');
          const chunk = citedChunks.find((i: any) => i.id === chunkId);
          if (chunk) {
            showCitation(chunk.content);
          } else {
            notifyInfo(t('Knowledge.Notification.CitationNotFound'));
          }
        }
      } catch (error) {
        console.error('Citation click error:', error);
        event.preventDefault();
      }
    },
    [citedChunks, showCitation, t, notifyInfo],
  );

  const renderECharts = useCallback(
    (prefix: string, msgDom: Element) => {
      const charts = msgDom.querySelectorAll('.echarts-container');
      if (charts.length > 0) {
        charts.forEach((chart) => {
          initECharts(prefix, chart.id);
        });
      }
    },
    [initECharts],
  );

  const [isReasoning, setIsReasoning] = useState(true);
  const [reasoningSeconds, setReasoningSeconds] = useState(0);
  const [isReasoningShow, setIsReasoningShow] = useState(false);
  const messageRef = useRef(message);
  const isReasoningRef = useRef(isReasoning);
  const reasoningInterval = useRef<number | null>(null);
  const reasoningRef = useRef('');
  const replyRef = useRef('');
  const hasStartedReasoning = useRef(false);

  useEffect(() => {
    messageRef.current = message;
  }, [message.id, message.isActive]);

  useEffect(() => {
    isReasoningRef.current = isReasoning;
  }, [isReasoning]);

  const reply = useMemo(() => getNormalContent(message.reply), [message.reply]);
  const reasoning = useMemo(
    () => getReasoningContent(message.reply, message.reasoning),
    [message.reply, message.reasoning],
  );

  useEffect(() => {
    if (reasoning) {
      setIsReasoning(true);
    } else {
      setIsReasoning(false);
    }
  }, [reasoning]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      replyRef.current = reply;
      reasoningRef.current = reasoning;
      setDeferredReply(reply);
      setDeferredReasoning(reasoning);
    });
    return () => cancelAnimationFrame(frameId);
  }, [reply, reasoning]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const promptNode = document.querySelector(`#${message.id} .msg-prompt`);
      if (promptNode) {
        renderECharts('prompt', promptNode);
      }
      const replyNode = document.querySelector(`#${message.id} .msg-reply`);
      if (!replyNode) return;
      const links = replyNode.querySelectorAll('a');
      links.forEach((link) => {
        link.removeEventListener('click', onCitationClick);
        link.addEventListener('click', onCitationClick);
      });
      renderECharts('reply', replyNode);
      renderMermaid();
    }, 10);

    return () => {
      clearTimeout(timer);
      const replyNode = document.querySelector(`#${message.id} .msg-reply`);
      const links = replyNode?.querySelectorAll('a');
      links?.forEach((link) => {
        link.removeEventListener('click', onCitationClick);
      });
      disposeECharts();
    };
  }, [message.id, message.isActive]);

  function monitorThinkStatus() {
    if (reasoningInterval.current) {
      clearInterval(reasoningInterval.current);
    }

    reasoningInterval.current = setInterval(() => {
      if (isReasoningRef.current && messageRef.current.isActive) {
        setReasoningSeconds((prev) => prev + 1);
      }

      if (
        !!replyRef.current.trim() &&
        isReasoningRef.current &&
        messageRef.current.isActive
      ) {
        clearInterval(reasoningInterval.current as number);
        setIsReasoning(false);
        debug('Reasoning ended');
        debug(`Total thinking time: ${reasoningSeconds} seconds`);
      }
    }, 1000) as any;
  }

  useEffect(() => {
    if (reasoning && !hasStartedReasoning.current && message.isActive) {
      hasStartedReasoning.current = true;
      setIsReasoning(true);
      setIsReasoningShow(true);
      monitorThinkStatus();
    } else if (!reasoning) {
      hasStartedReasoning.current = false;
      setIsReasoning(false);
    }
  }, [reasoning, message.isActive]);

  useEffect(() => {
    if (!message.isActive) {
      hasStartedReasoning.current = false;
      setIsReasoning(false);
    }
    return () => {
      clearInterval(reasoningInterval.current as number);
      hasStartedReasoning.current = false;
      setIsReasoning(false);
    };
  }, [message.id, message.isActive]);

  const toggleThink = useCallback(() => {
    setIsReasoningShow(!isReasoningShow);
  }, [isReasoningShow]);

  const replyNode = () => {
    const isLoading = message.isActive && states.loading;
    const isEmpty =
      (!message.reply || message.reply === '') &&
      (!message.reasoning || message.reasoning === '');
    const thinkTitle = `${isReasoning ? t('Reasoning.Thinking') : t('Reasoning.Thought')
      }${reasoningSeconds > 0 ? ` ${reasoningSeconds}s` : ''}`;
    return (
      <div className={`w-full mt-1.5 ${isLoading ? 'is-loading' : ''}`}>
        {message.isActive && states.runningTool ? (
          <div className="flex flex-row justify-start items-center gap-1">
            <ToolSpinner size={20} style={{ marginBottom: '-1px' }} />
            <span>{states.runningTool.replace('--', ':')}</span>
          </div>
        ) : null}
        {isLoading && isEmpty ? (
          <>
            <span className="skeleton-box" style={{ width: '80%' }} />
            <span className="skeleton-box" style={{ width: '90%' }} />
          </>
        ) : (
          <div className="-mt-1">
            {reasoning.trim() ? (
              <div className="think">
                <div className="think-header" onClick={toggleThink}>
                  <span className="font-bold text-gray-400 ">{thinkTitle}</span>
                  <div className="text-gray-400 -mb-0.5">
                    {isReasoningShow ? (
                      <ChevronUp16Regular />
                    ) : (
                      <ChevronDown16Regular />
                    )}
                  </div>
                </div>
                <div
                  className="think-body"
                  style={{ display: isReasoningShow ? 'block' : 'none' }}
                >
                  <div
                    dangerouslySetInnerHTML={{
                      __html: render(
                        `${highlight(deferredReasoning, keyword) || ''
                        }${isReasoning && deferredReasoning ? '<span class="blinking-cursor" /></span>' : ''}`,
                      ),
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div
              lang="en"
              className="break-words hyphens-auto mt-1"
              dangerouslySetInnerHTML={{
                __html: render(
                  `${highlight(deferredReply, keyword) || ''
                  }${isLoading && deferredReply ? '<span class="blinking-cursor" /></span>' : ''}`,
                ),
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="leading-6 message" id={message.id}>
      <div>
        <a
          id={`prompt-${message.id}`}
          aria-label={`prompt of message ${message.id}`}
        />

        <div
          className="msg-prompt my-2 flex flex-start"
          style={{ minHeight: '40px' }}
        >
          <div className="avatar flex-shrink-0 mr-2" />
          <div
            className="mt-1 break-word"
            dangerouslySetInnerHTML={{
              __html: render(highlight(message.prompt, keyword) || ''),
            }}
          />
        </div>
      </div>
      <div>
        <a id={`#reply-${message.id}`} aria-label={`Reply ${message.id}`} />
        <div
          className="msg-reply mt-2 flex flex-start"
          style={{ minHeight: '40px' }}
        >
          <div className="avatar flex-shrink-0 mr-2" />
          {replyNode()}
        </div>
        {citedFiles.length > 0 && (
          <div className="message-cited-files mt-2">
            <div className="mt-4 mb-2">
              <Divider>{t('Common.References')}</Divider>
            </div>
            <ul>
              {citedFiles.map((file: string) => (
                <li className="text-gray-500" key={file}>
                  {file}
                </li>
              ))}
            </ul>
          </div>
        )}
        <MessageToolbar message={message} />
      </div>
    </div>
  );
}
