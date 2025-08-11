/* eslint-disable react/no-danger */
import {
  Dialog,
  DialogTrigger,
  Button,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Combobox,
  OptionGroup,
  Option,
} from '@fluentui/react-components';
import Mousetrap from 'mousetrap';
import {
  bundleIcon,
  CommentMultipleLinkFilled,
  CommentMultipleLinkRegular,
  Dismiss24Regular,
} from '@fluentui/react-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNil } from 'lodash';
import { IChat } from 'intellichat/types';
import {
  IMCPPrompt,
  IMCPPromptArgument,
  IMCPPromptListItem,
  IMCPPromptListItemData,
  IMCPPromptMessageItem,
} from 'types/mcp';
import useToast from 'hooks/useToast';
import Spinner from 'renderer/components/Spinner';
import { captureException } from 'renderer/logging';
import McpPromptVariableDialog from '../McpPromptVariableDialog';

const PromptIcon = bundleIcon(
  CommentMultipleLinkFilled,
  CommentMultipleLinkRegular,
);

export default function McpPromptCtrl({
  chat,
  disabled,
  onTrigger,
}: {
  chat: IChat;
  disabled?: boolean;
  onTrigger?: (prompt: unknown) => void;
}) {
  const { t } = useTranslation();
  const { notifyError } = useToast();
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const [variableDialogOpen, setVariableDialogOpen] = useState<boolean>(false);
  const [variables, setVariables] = useState<IMCPPromptArgument[]>([]);
  const [promptItem, setPromptItem] = useState<
    (IMCPPromptListItemData & { client: string }) | null
  >(null);
  const [options, setOptions] = useState<IMCPPromptListItem[]>([]);
  const [prompt, setPrompt] = useState<IMCPPrompt | null>(null);

  const closeDialog = () => {
    setOpen(false);
    Mousetrap.unbind('esc');
  };

  const openDialog = () => {
    setOpen(true);
    setLoadingList(true);
    setPrompt(null);
    window.electron.mcp
      .listPrompts()
      .then((res: { error?: string; prompts: IMCPPromptListItem[] }) => {
        setOptions(res.prompts || []);
        setLoadingList(false);
        return res.prompts;
      })
      .catch((error) => {
        setLoadingList(false);
        captureException(error);
      });
    Mousetrap.bind('esc', closeDialog);
  };

  const applyPrompt = async (promptName: string) => {
    const [client, name] = promptName.split('-');
    const group = options.find((option) => option.client === client);
    if (group) {
      const item = group.prompts.find(
        (p: IMCPPromptListItemData) => p.name === name,
      ) as IMCPPromptListItemData & { client: string };
      item.client = client;
      setPromptItem(item);
      setVariables(item?.arguments || []);
      if ((item?.arguments?.length || 0) > 0) {
        setVariableDialogOpen(true);
      } else {
        const $prompt = await window.electron.mcp.getPrompt({ client, name });
        if ($prompt.isError) {
          notifyError(
            $prompt.error || 'Unknown error occurred while fetching prompt',
          );
          return;
        }
        setPrompt($prompt);
      }
    }
    window.electron.ingestEvent([{ app: 'apply-mcp-prompt' }]);
  };

  const removePrompt = useCallback(() => {
    setOpen(false);
    setPromptItem(null);
    setPrompt(null);
    setVariableDialogOpen(false);
  }, []);

  const onVariablesCancel = useCallback(() => {
    setPromptItem(null);
    setVariableDialogOpen(false);
  }, [setPromptItem]);

  const onVariablesConfirm = useCallback(
    async (args: { [key: string]: string }) => {
      if (isNil(promptItem)) {
        return;
      }
      const $prompt = await window.electron.mcp.getPrompt({
        client: promptItem.client,
        name: promptItem.name,
        args,
      });
      if ($prompt.isError) {
        notifyError(
          $prompt.error || 'Unknown error occurred while fetching prompt',
        );
        return;
      }
      setPrompt($prompt);
      setVariableDialogOpen(false);
    },
    [promptItem, chat.id],
  );

  useEffect(() => {
    Mousetrap.bind('mod+shift+2', openDialog);
    return () => {
      Mousetrap.unbind('mod+shift+2');
    };
  }, [open]);

  const renderOptions = useCallback(() => {
    if (loadingList) {
      return (
        <Option text={t('Common.Loading')} value="" disabled>
          <div className="flex justify-start gap-2 items-center">
            <Spinner className="w-2 h-2 -ml-4" />
            <span>{t('Common.Loading')}</span>
          </div>
        </Option>
      );
    }
    if (!options || options.length === 0) {
      return (
        <Option text={t('Common.NoPrompts')} value="" disabled>
          {t('Common.NoPrompts')}
        </Option>
      );
    }
    return options.map((option) => (
      <OptionGroup label={option.client} key={option.client}>
        {option.prompts.map((promptOption: IMCPPromptListItemData) => (
          <Option
            key={`${option.client}-${promptOption.name}`}
            value={`${option.client}-${promptOption.name}`}
          >
            {promptOption.name}
          </Option>
        ))}
      </OptionGroup>
    ));
  }, [loadingList, options]);

  const renderPrompt = useCallback(() => {
    if (!prompt) {
      return (
        <div className="py-6 px-1 tips">{t('Common.NoPromptSelected')}</div>
      );
    }
    const renderContent = (message: IMCPPromptMessageItem) => {
      if (message.content.type === 'image') {
        return <img src={message.content.data} alt="" className="w-full" />;
      }
      if (message.content.type === 'audio') {
        return (
          <audio controls>
            <source
              src={message.content.data}
              type={message.content.mimeType}
            />
            <track
              kind="captions"
              label={t('Common.NoSubtitlesAvailable')}
              default
            />
            Your browser does not support the audio element.
          </audio>
        );
      }
      return <pre>{message.content.text || ''}</pre>;
    };
    return prompt.messages.map((message: IMCPPromptMessageItem) => {
      return (
        <fieldset
          className="border border-neutral-200 dark:border-neutral-700 rounded p-1 my-2 bg-neutral-50 dark:bg-neutral-800"
          key={`${message.role}-${message.content.text}`}
        >
          <legend className="text-base font-semibold px-1 ml-2">
            {message.role}&nbsp;
            <span className="text-sm text-neutral-500">
              ({message.content.type})
            </span>
          </legend>
          {renderContent(message)}
        </fieldset>
      );
    });
  }, [prompt, t]);

  const onSubmit = useCallback(async () => {
    if (prompt && promptItem) {
      onTrigger?.({
        name: promptItem.name,
        description: promptItem.description,
        messages: prompt.messages,
      });

      // Close the dialog and clear prompt state.
      removePrompt();
    }
  }, [prompt, promptItem, removePrompt, onTrigger]);

  return (
    <>
      <Dialog open={open} onOpenChange={(_, data) => setOpen(data.open)}>
        <DialogTrigger disableButtonEnhancement>
          <Button
            disabled={disabled}
            size="small"
            title={`${t('Common.Prompts')}(Mod+Shift+2)`}
            aria-label={t('Common.Prompts')}
            appearance="subtle"
            style={{ borderColor: 'transparent', boxShadow: 'none' }}
            className={`flex justify-start items-center text-color-secondary gap-1 ${disabled ? 'opacity-50' : ''}`}
            onClick={openDialog}
            icon={<PromptIcon className="flex-shrink-0" />}
          />
        </DialogTrigger>
        <DialogSurface>
          <DialogBody>
            <DialogTitle
              action={
                <DialogTrigger action="close">
                  <Button
                    appearance="subtle"
                    aria-label="close"
                    onClick={closeDialog}
                    icon={<Dismiss24Regular />}
                  />
                </DialogTrigger>
              }
            >
              <div className="flex justify-start items-center gap-1 font-semibold font-sans">
                MCP<span className="separator">/</span> {t('Common.Prompts')}
              </div>
            </DialogTitle>
            <DialogContent>
              <Combobox
                placeholder={t('Common.Search')}
                className="w-full"
                onOptionSelect={(e, data) => {
                  applyPrompt(data.optionValue as string);
                }}
              >
                {renderOptions()}
              </Combobox>
              <div>{renderPrompt()}</div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" onClick={removePrompt}>
                  {t('Common.Cancel')}
                </Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                disabled={isNil(prompt)}
                onClick={onSubmit}
              >
                {t('Common.Submit')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <McpPromptVariableDialog
        open={variableDialogOpen}
        variables={variables}
        onCancel={onVariablesCancel}
        onConfirm={onVariablesConfirm}
      />
    </>
  );
}
