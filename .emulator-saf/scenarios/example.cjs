// Template for a backend-requested scenario. Copy, rename, edit the app-side clicks to match the spike UI.
// Flow shown: tap the app's Open Folder control, pick GonqSpike in the system picker, relaunch after force-stop.
module.exports = async ({ device, L }) => {
  let p = await L.webPage(device);
  await p.getByText(/open folder/i).first().click();            // spike UI control (adjust)
  await L.pickTree(['Documents', 'GonqSpike'], 'pick');         // system picker
  p = await L.webPage(device); L.shot('pick-after');
  L.log('persisted grants listed', true, L.persistedGrants().slice(0, 500));
  L.forceStop(); await L.launch(); L.shot('relaunch');
  L.externalWrite('/sdcard/Documents/GonqSpike/a.md', '# Alpha changed externally\n'); // conflict check
};
