import useNav from 'hooks/useNav';
import { useEffect, useState } from 'react';
import ToolInstallDialog from 'renderer/pages/tool/InstallDialog';
import { IMCPServer } from 'types/mcp';

export default function ToolSetup() {
  const navigate = useNav();
  const [mcpServer, setMcpServer] = useState<IMCPServer>();
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  useEffect(() => {
    window.electron.ipcRenderer.on('install-tool', async (data: any) => {
      navigate('/tool');
      setMcpServer(data);
      setInstallDialogOpen(true);
    });
  }, []);

  return mcpServer ? (
    <ToolInstallDialog
      server={mcpServer as IMCPServer}
      open={installDialogOpen}
      setOpen={setInstallDialogOpen}
    />
  ) : null;
}
