import './WindowsTitleBar.scss';
import logoImage from '../../../../assets/images/logo.png';

function WindowsTitleBar() {
  return (
    <div className="custom-titlebar border-b border-base">
      <img src={logoImage} alt="logo" className=" size-5" />
      <div className=" text-xs  font-mono">5ire</div>
    </div>
  );
}

export default WindowsTitleBar;
