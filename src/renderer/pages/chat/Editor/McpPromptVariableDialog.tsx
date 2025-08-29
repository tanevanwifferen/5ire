import {
  Dialog,
  DialogTrigger,
  Button,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  Field,
  Input,
  DialogActions,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IMCPPromptArgument } from 'types/mcp';

export default function PromptVariableDialog(args: {
  open: boolean;
  variables: IMCPPromptArgument[];
  onCancel: () => void;
  onConfirm: (vars: { [key: string]: string }) => void;
}) {
  const { t } = useTranslation();
  const { open, variables, onCancel, onConfirm } = args;

  const [requiredError, setRequiredError] = useState<string | null>(null);
  const [values, setValues] = useState<{ [key: string]: string }>({});

  const onValuesChange = (key: string, value: string) => {
    setValues({ ...values, [key]: value });
  };

  const handleConfirm = () => {
    setRequiredError(null);

    const requiredVariables = variables.filter((arg) => {
      return arg.required && !values[arg.name]?.trim();
    });

    if (requiredVariables.length > 0) {
      setRequiredError(requiredVariables.map((arg) => arg.name).join(', '));
    } else {
      onConfirm(values);
      setValues({});
      setRequiredError(null);
    }
  };

  return (
    <Dialog open={open}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle
            action={
              <DialogTrigger action="close">
                <Button
                  appearance="subtle"
                  aria-label="close"
                  icon={<Dismiss24Regular />}
                  onClick={onCancel}
                />
              </DialogTrigger>
            }
          >
            {t('Prompt.FillVariables')}
          </DialogTitle>
          <DialogContent>
            {requiredError ? (
              <MessageBar intent="error">
                <MessageBarBody>
                  {t('Prompt.RequiredVariables', {
                    variables: requiredError,
                  })}
                </MessageBarBody>
              </MessageBar>
            ) : null}
            <div>
              {variables.length ? (
                <div>
                  {variables.map((variable) => {
                    return (
                      <Field
                        label={variable.name}
                        key={`var-${variable.name}`}
                        className="my-2"
                      >
                        <Input
                          className="w-full"
                          value={values[variable.name] || ''}
                          placeholder={
                            variable.required
                              ? t('Common.Required')
                              : t('Common.Optional')
                          }
                          onChange={(e) =>
                            onValuesChange(variable.name, e.target.value || '')
                          }
                        />
                      </Field>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </DialogContent>
          <DialogActions>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="subtle" onClick={onCancel}>
                {t('Common.Cancel')}
              </Button>
            </DialogTrigger>
            <Button appearance="primary" onClick={handleConfirm}>
              {t('Common.OK')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
