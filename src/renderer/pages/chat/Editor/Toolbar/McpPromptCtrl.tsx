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
} from 'types/mcp';
import McpPromptVariableDialog from '../McpPromptVariableDialog';
import useToast from 'hooks/useToast';
import useMarkdown from 'hooks/useMarkdown';
import Spinner from 'renderer/components/Spinner';

const PromptIcon = bundleIcon(CommentMultipleLinkFilled, CommentMultipleLinkRegular);

export default function McpPromptCtrl({
  chat,
  disabled,
}: {
  chat: IChat;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { render } = useMarkdown();
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
    window.electron.mcp
      .listPrompts()
      .then((prompts: IMCPPromptListItem[]) => {
        setOptions(prompts);
        setLoadingList(false);
        return prompts;
      })
      .catch((error) => {
        setLoadingList(false);
        console.error('Error fetching prompts:', error);
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

  const removePrompt = () => {
    setOpen(false);
    setPromptItem(null);
    setPrompt(null);
    setVariableDialogOpen(false);
  };

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
          ></Button>
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
              MCP {t('Common.Prompts')}
            </DialogTitle>
            <DialogContent>
              <Combobox
                placeholder={t('Common.Search')}
                className="w-full"
                onOptionSelect={(e, data) => {
                  applyPrompt(data.optionValue as string);
                }}
              >
                {loadingList ? (
                  <Option text={t('Common.Loading')} value="" disabled>
                    <div className="flex justify-start gap-2 items-center">
                      <Spinner className="w-2 h-2 -ml-4" />
                      <span>{t('Common.Loading')}</span>
                    </div>
                  </Option>
                ) : (
                  options.map((option) => (
                    <OptionGroup label={option.client} key={option.client}>
                      {option.prompts.map(
                        (promptOption: IMCPPromptListItemData) => (
                          <Option
                            key={`${option.client}-${promptOption.name}`}
                            value={`${option.client}-${promptOption.name}`}
                          >
                            {promptOption.name}
                          </Option>
                        ),
                      )}
                    </OptionGroup>
                  ))
                )}
              </Combobox>
              <div>
                {prompt ? (
                  <div
                    className="text-xs bg-neutral-50 dark:bg-neutral-800 p-2 rounded-md mt-2"
                    dangerouslySetInnerHTML={{
                      __html: render(
                        `\`\`\`json\n${JSON.stringify({ messages: prompt?.messages }, null, 2)}\n\`\`\``,
                      ),
                    }}
                  />
                ) : (
                  <div className="h-12"></div>
                )}
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" onClick={removePrompt}>
                  {t('Common.Cancel')}
                </Button>
              </DialogTrigger>
              <Button appearance="primary" disabled={isNil(prompt)}>
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
