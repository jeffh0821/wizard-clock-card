const CARDNAME = "wizard-clock-card";
const VERSION = "0.9.0";

const debugLogging = false;

class WizardClockCard extends HTMLElement {

  // Whenever the state changes, a new `hass` object is set: Update content.
  set hass(hass) {
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}set hass start`);
    this._hass = hass;

    // Scale the canvas to fit the available space
    this.availableWidth = Math.min(this.card.offsetWidth, window.innerWidth, window.innerHeight).toFixed(0) - 16;
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}availableWidth: ${this.availableWidth}px`);
    if (this.availableWidth <= 0) {
      if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}skipping update`);
      return;
    }
    this.availableWidth = Math.round(Math.min(this.availableWidth, this.configuredWidth));

    this.canvas.width = this.configuredWidth;
    this.canvas.height = this.configuredWidth;
    this.canvas.style.width = `${this.availableWidth}px`;
    this.canvas.style.height = `${this.availableWidth}px`;
    this.scaleRatio = this.configuredWidth / this.availableWidth;

    this.radius = this.canvas.height / 2;
    this.ctx.translate(this.radius, this.radius);
    this.radius = this.radius * 0.90;

    // Get information about current locations and wizards
    this.zones = [];
    this.targetstate = [];
  
    if (this.lastframe && this.lastframe != 0){
      cancelAnimationFrame(this.lastframe);
      this.lastframe = 0;
    }

    var num;
    if (this.config.locations){
      for (num = 0; num < this.config.locations.length; num++){
        if (this.zones.indexOf(this.config.locations[num]) == -1){
          this.zones.push(this.config.locations[num]);
        }
      }
    }
    if (this.config.travelling){
      this.zones.push(this.travellingState);
    }
    if (this.config.lost){
      this.zones.push(this.lostState);
    }

    for (num = 0; num < this.config.wizards.length; num++){
      var stateStr = this.getWizardState(this.config.wizards[num].entity);
      if (debugLogging) {
        console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}(${this.config.wizards[num].name}) set hass stateStr: ${stateStr}`);
      }

      if (this.zones.indexOf(stateStr) == -1)  {
        if (typeof(stateStr)!=="string")
          throw new Error("Unable to add state for entity " + this.config.wizards[num].entity + " of type " + typeof(stateStr) + ".");
        this.zones.push(stateStr);
      }
    }

    if (this.zones.length < this.min_location_slots) {
      for (num = this.zones.length; num < this.min_location_slots; num++){
        this.zones.push(' ');
      }
    }

    // Precompute layout for zones (dynamic font sizing + word-wrap)
    this.zoneLayout = this.computeZoneLayout(this.zones, this.radius);

    var obj = this;
    this.lastframe = requestAnimationFrame(function(){ 
      obj.drawClock(); 
    });
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}set hass end`);
  }

  // setConfig is called when the configuration changes.
  // Throw an exception and Home Assistant will render an error card.
  setConfig(config) {
    console.info("%c %s %c %s",
      "color: white; background: forestgreen; font-weight: 700;",
      CARDNAME.toUpperCase(),
      "color: forestgreen; background: white; font-weight: 700;",
      VERSION,
    );

    if (!config.wizards) {
      throw new Error('You need to define some wizards');
    }
    
    this.config = config;
    this.currentstate = [];
    this.lostState = config.lost ? config.lost : "Away";
    this.travellingState = config.travelling ? config.travelling : "Away";
    this.min_location_slots = this.config.min_location_slots ? this.config.min_location_slots : 0;
    
    if (this.config.shaft_colour){
      this.shaft_colour = this.config.shaft_colour;
    }
    else {
      this.shaft_colour = getComputedStyle(document.documentElement).getPropertyValue('--primary-color');
    }    

    if (this.config.fontName) {
      this.selectedFont = this.config.fontName;
    } else {
      this.selectedFont = "itcblkad_font";
    }
    this.fontScale = 1.1;

    this.exclude = [];
    if (this.config.exclude){
      for (var num = 0; num < this.config.exclude.length; num++){
        if (this.exclude.indexOf(this.config.exclude[num]) == -1){
          this.exclude.push(this.config.exclude[num]);
        }
      }
    }

    // Create hidden div for text measurement (reused)
    if (!this.measureDiv) {
      this.measureDiv = document.createElement('div');
      this.measureDiv.style.position = 'absolute';
      this.measureDiv.style.top = '-10000px';
      this.measureDiv.style.left = '-10000px';
      this.measureDiv.style.visibility = 'hidden';
      document.body.appendChild(this.measureDiv);
    }

    // Set up document canvas.
    this.configuredWidth = this.config.width ? this.config.width : "500";

    if (!this.canvas) {
      this.card = document.createElement('ha-card');
      if (this.config.header) {
        this.card.header = this.config.header;
      }
      var fontstyle = document.createElement('style');
      if (this.config.fontface){
        fontstyle.innerText = "@font-face { " + this.config.fontface + " }  ";
      } else {
        // my default
        fontstyle.innerText = "@font-face {    font-family: itcblkad_font;    src: local(itcblkad_font), url('/local/ITCBLKAD.TTF') format('opentype');}  ";
      }
      document.body.appendChild(fontstyle);

      this.div = document.createElement('div');
      this.div.style.textAlign = 'center';
      this.canvas = document.createElement('canvas');
      this.div.appendChild(this.canvas);
      this.card.appendChild(this.div);
      this.appendChild(this.card);
      if (!this.canvas.getContext)
        throw new Error("Browser does not support " + CARDNAME + " canvas.");
      this.ctx = this.canvas.getContext("2d");

      /* watch for changes in the size of the card */
      const observer = createResizeObserver(this);
      observer.observe(this.card);
    }
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}getConfig end`);
  }

  // Compute per-zone layout: decide on line count (wrap) and font size to fit within zone's arc.
  computeZoneLayout(zones, radius) {
    const layout = [];
    const maxFontSize = radius * 0.15 * this.fontScale;
    const minFontSize = 10;
    const allowedAngleFactor = 0.75; // use 75% of zone angle to leave gap
    const totalZones = zones.length;
    const zoneAngle = (Math.PI * 2) / totalZones;
    const allowedAngle = zoneAngle * allowedAngleFactor;
    const lineSpacingFactor = 0.2; // spacing between lines as fraction of lineHeight

    // Helper to measure text dimensions
    const measure = (txt, fontSize) => {
      this.measureDiv.style.font = `${fontSize}px ${this.selectedFont}`;
      this.measureDiv.textContent = txt;
      return {
        width: this.measureDiv.offsetWidth,
        height: this.measureDiv.offsetHeight
      };
    };

    for (let i = 0; i < zones.length; i++) {
      const text = zones[i];
      let best = {
        lines: [text],
        fontSize: minFontSize,
        lineHeight: 0
      };

      // Try single line first
      let fontSize = maxFontSize;
      let fitsSingle = false;
      while (fontSize > minFontSize) {
        const dim = measure(text, fontSize);
        const textRadius = radius - dim.height;
        if (textRadius <= 0) { fontSize = minFontSize; break; }
        const requiredAngle = dim.width / textRadius;
        if (requiredAngle <= allowedAngle) {
          best = {
            lines: [text],
            fontSize: fontSize,
            lineHeight: dim.height
          };
          fitsSingle = true;
          break;
        }
        fontSize *= 0.95; // reduce by 5%
      }

      if (!fitsSingle) {
        // Even at minFontSize, check single line
        const dimMin = measure(text, minFontSize);
        const textRadiusMin = radius - dimMin.height;
        if (textRadiusMin > 0 && (dimMin.width / textRadiusMin) <= allowedAngle) {
          best = {
            lines: [text],
            fontSize: minFontSize,
            lineHeight: dimMin.height
          };
          fitsSingle = true;
        }
      }

      if (!fitsSingle) {
        // Need to wrap: split into two lines
        let line1, line2;
        const words = text.split(' ');
        if (words.length >= 2) {
          // Find split that minimizes maximum width (at current fontSize guess)
          let bestSplitIdx = 0;
          let minMaxWidth = Infinity;
          // We'll estimate widths using current maxFontSize; fine.
          for (let split = 1; split < words.length; split++) {
            const l1 = words.slice(0, split).join(' ');
            const l2 = words.slice(split).join(' ');
            const w1 = measure(l1, maxFontSize).width;
            const w2 = measure(l2, maxFontSize).width;
            const maxW = Math.max(w1, w2);
            if (maxW < minMaxWidth) {
              minMaxWidth = maxW;
              bestSplitIdx = split;
            }
          }
          line1 = words.slice(0, bestSplitIdx).join(' ');
          line2 = words.slice(bestSplitIdx).join(' ');
        } else {
          // Hard split in middle
          const mid = Math.floor(text.length / 2);
          line1 = text.substring(0, mid);
          line2 = text.substring(mid);
        }

        // Find best fontSize for both lines
        fontSize = maxFontSize;
        let bestFontSizeTwo = minFontSize;
        while (fontSize > minFontSize) {
          const dim1 = measure(line1, fontSize);
          const dim2 = measure(line2, fontSize);
          const r1 = radius - dim1.height;
          const r2 = radius - dim2.height;
          if (r1 <= 0 || r2 <= 0) { fontSize = minFontSize; break; }
          const angle1 = dim1.width / r1;
          const angle2 = dim2.width / r2;
          if (angle1 <= allowedAngle && angle2 <= allowedAngle) {
            bestFontSizeTwo = fontSize;
            break;
          }
          fontSize *= 0.95;
        }
        if (fontSize <= minFontSize) {
          // Check at min
          const dim1 = measure(line1, minFontSize);
          const dim2 = measure(line2, minFontSize);
          const r1 = radius - dim1.height;
          const r2 = radius - dim2.height;
          if (r1 > 0 && r2 > 0 && (dim1.width / r1) <= allowedAngle && (dim2.width / r2) <= allowedAngle) {
            bestFontSizeTwo = minFontSize;
          } else {
            bestFontSizeTwo = minFontSize; // still use min, may slightly overflow edge case
          }
        }
        const finalDim = measure(line1, bestFontSizeTwo); // heights should be similar for both lines
        best = {
          lines: [line1, line2],
          fontSize: bestFontSizeTwo,
          lineHeight: finalDim.height
        };
      }

      layout.push(best);
    }
    return layout;
  }

  // getCardSize Indicates the height of the card in 50px units. 
  // Home Assistant uses this to automatically distribute all cards over the available columns.
  getCardSize() {
    var cardSize = (this.configuredWidth / 50).toFixed(1);
    if (debugLogging) console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}getCardSize = ${cardSize}`);
    return cardSize;
  }

  // get-WizardState makes all decisions about what stateStr should be. (What "number" to point to.)
  getWizardState(entity) {
    const state = this._hass.states[entity];
    if (!state) {
      console.log(`${this.config.header ? "(" + this.config.header + ") " : ""}Wizard ${entity} does not exist.`);
      return this.lostState;
    }
    const stateVelo = state && state.attributes ? (
      state.attributes.velocity ? state.attributes.velocity : (
        state.attributes.speed ? state.attributes.speed : (
          state.attributes.moving ? 16 : 0
    ))) : 0;

    /* Prioritize stateStr: 1. message attribute, 2. zone attribute, 3. state */
    var stateStr = "not_home";
    if (state && state.state && state.state !== "off" && state.state !== "unknown") {
        /* Keep the not-so-binary states from person_location integration */
        if (["home", "Home", "Just Arrived", "Just Left"].includes(state.state) && !this.exclude.includes(state.state)) {
          stateStr = state.state;
        } else if (state.attributes) {
            if (state.attributes.message) {
                stateStr = state.attributes.message;
            } else if (state.attributes.zone) {
                stateStr = state.attributes.zone;
            } else {
                stateStr = state.state;
            }
        } else {
            stateStr = state.state;
        }
    }
    /* Skip location if excluded in the config (could be reported below as locality, travelling, or lost */
    if (this.exclude.includes(stateStr)){
      stateStr = 'not_home';
    }
    /* Use friendly name for zones */
    if (this._hass.states["zone." + stateStr] && this._hass.states["zone." + stateStr].attributes && this._hass.states["zone." + stateStr].attributes.friendly_name)
    {
      stateStr = this._hass.states["zone." + stateStr].attributes.friendly_name;
    }
    /* If away and not in a zone, show locality (if locality is geocoded),
    /* otherwise show travelling (if configured and velocity > 15),
    /* otherwise show lost (if configured) or Away */
    if (stateStr.toLowerCase() === 'away' || stateStr === 'not_home') {
      if (stateVelo > 15 && this.config.travelling) {
        stateStr = this.travellingState;
      } else {
        stateStr = this.lostState;
      }
      if (state.attributes.locality && !this.exclude.includes(state.attributes.locality)) {
        stateStr = state.attributes.locality
      }
    } else if (stateStr === 'unavailable') {
      stateStr = this.lostState;
    }
    return stateStr;
  }

  drawClock() {
      this.lastframe = 0;

      this.ctx.clearRect(-this.canvas.width/2, -this.canvas.height/2, this.canvas.width/2, this.canvas.height/2)
      this.drawFace(this.ctx, this.radius);
      this.drawNumbers(this.ctx, this.radius, this.zones);
      this.drawTime(this.ctx, this.radius, this.zones, this.config.wizards);
      this.drawHinge(this.ctx, this.radius, this.shaft_colour);
      // request next frame if required
      var redraw = false;
      var num;
      for (num = 0; num < this.currentstate.length; num++){
        if (Math.round(this.currentstate[num].pos*100) != Math.round(this.targetstate[num].pos*100))
        {
          redraw = true;
        }
      }

      if (redraw){
        var obj = this;
        this.lastframe = requestAnimationFrame(function(){ 
          obj.drawClock(); 
        });
      }
  }

  drawFace(ctx, radius) {
    ctx.shadowColor = null;
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, 2*Math.PI);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--secondary-background-color');
    ctx.fill();

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-background-color:');
    ctx.lineWidth = radius*0.02;
    ctx.stroke();
  }

  drawHinge(ctx, radius, colour) {
    ctx.beginPath();
    ctx.arc(0, 0, radius*0.05, 0, 2*Math.PI);
    ctx.fillStyle = colour;
    ctx.shadowColor = "#0008";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.fill();
  }

  drawNumbers(ctx, radius, locations) {
      /* 
        Text on a curve code modified from function written by James Alford here: http://blog.graphicsgen.com/2015/03/html5-canvas-rounded-text.html
        Supports multi-line zone labels via precomputed zoneLayout.
      */
      var ang;
      var num;
      
      // Base font size from config, but we'll override per-zone with layout if available
      const zones = this.zoneLayout || null;
      const hasLayout = !!zones;
      
      for(num = 0; num < locations.length; num++){
          ang = num * Math.PI / locations.length * 2;
          
          // Determine font and line(s) for this zone
          let zoneFontSize = radius*0.15*this.fontScale;
          let zoneLines = [locations[num]];
          let lineHeight = 0;
          
          if (hasLayout && zones[num]) {
            zoneFontSize = zones[num].fontSize;
            zoneLines = zones[num].lines;
            lineHeight = zones[num].lineHeight;
          }
          
          // Set font for this zone (may differ per zone if layout computed)
          ctx.font = zoneFontSize + "px " + this.selectedFont;
          ctx.textBaseline="middle";
          ctx.textAlign="center";
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-text-color');
          
          // rotate to center of drawing position
          ctx.rotate(ang);

          var startAngle = 0; 
          var inwardFacing = true;
          var kerning = 0; 
          
          // Process each line (support for word-wrap)
          for (var lineIdx = 0; lineIdx < zoneLines.length; lineIdx++) {
            var lineText = zoneLines[lineIdx];
            if (lineIdx === 0) {
              // First line: use original orientation and splitting
              var text = lineText.split("").reverse().join("");
              if (ang > Math.PI / 2 && ang < ((Math.PI * 2) - (Math.PI / 2))) {
                startAngle = Math.PI;
                inwardFacing = false;
                text = lineText;
              }
              text = this.isRtlLanguage(text) ? text.split("").reverse().join("") : text;
            } else {
              // Additional lines: same orientation as first
              text = inwardFacing ? lineText.split("").reverse().join("") : lineText;
              if (this.isRtlLanguage(text)) {
                text = text.split("").reverse().join("");
              }
            }

            // Determine textHeight for this line at this font size
            var div = document.createElement("div");
            div.innerHTML = text;
            div.style.position = 'absolute';
            div.style.top = '-10000px';
            div.style.left = '-10000px';
            div.style.fontFamily = this.selectedFont;
            div.style.fontSize = zoneFontSize + "px";
            document.body.appendChild(div);
            var textHeight = div.offsetHeight;
            document.body.removeChild(div);
            
            // Compute radial offset for this line: inner lines move inward
            var lineRadius = radius;
            if (lineIdx > 0 && lineHeight > 0) {
              var lineSpacing = lineHeight * 0.2;
              lineRadius = radius - (lineHeight + lineSpacing) * lineIdx;
              if (lineRadius <= lineHeight) break; // too small, skip
            }

            // rotate 50% of total angle for center alignment
            var lineStartAngle = startAngle;
            for (var j = 0; j < text.length; j++) {
                var charWid = ctx.measureText(text[j]).width;
                lineStartAngle += ((charWid + (j == text.length-1 ? 0 : kerning)) / (lineRadius - textHeight)) / 2 ;
            }

            // Phew... now rotate into final start position
            ctx.rotate(lineStartAngle);

            // Now for the fun bit: draw, rotate, and repeat
            for (var j = 0; j < text.length; j++) {
                var charWid = ctx.measureText(text[j]).width;
                // rotate half letter
                ctx.rotate((charWid/2) / (lineRadius - textHeight) * -1); 
                // draw the character at "top" or "bottom" depending on inward or outward facing
                ctx.fillText(text[j], 0, (inwardFacing ? 1 : -1) * (0 - lineRadius + textHeight ));
                ctx.rotate((charWid/2 + kerning) / (lineRadius - textHeight) * -1); // rotate half letter
            }
            // rotate back round from the end position to the central position of the text
            ctx.rotate(lineStartAngle);
          }

          // rotate to the next location
          ctx.rotate(-ang);
      }
  }

  isRtlLanguage(text) {
    const rtlChar = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    return rtlChar.test(text);
  }

  drawTime(ctx, radius, locations, wizards){
      this.targetstate = [];
      var num;
      for (num = 0; num < wizards.length; num++){
        const state = this._hass.states[wizards[num].entity];
        var stateStr = state && state.state != "off" && state.state != "unknown" ? 
          (state.attributes ? 
            (state.attributes.message ? state.attributes.message : state.state) 
            : state.state
          )
          :  this.lostState;
        /* Point to locality if not in a zone (if locality is geocoded) */
        if (stateStr === 'Away') {
          if (state.attributes.locality) {
            stateStr = state.attributes.locality
          }
        }
	
        if (this.exclude.includes(stateStr) ||
	  (this._hass.states["zone." + stateStr] && this._hass.states["zone." + stateStr].attributes && this._hass.states["zone." + stateStr].attributes.friendly_name &&
          this.exclude.includes(this._hass.states["zone." + stateStr].attributes.friendly_name))) {

          stateStr = this.lostState;
	}
        // Check both velocity and proximity for movement
        const stateVelo = state && state.attributes ? (
          state.attributes.velocity ? state.attributes.velocity : (
            state.attributes.moving ? 16 : 0
          )) : 0;

        // New: Check proximity direction sensor if configured
        const isMovingByProximity = wizards[num].proximity_sensor &&
          this._hass.states[wizards[num].proximity_sensor] &&
          ['towards', 'away_from'].includes(this._hass.states[wizards[num].proximity_sensor].state);

        var locnum;
        var wizardOffset = ((num-((wizards.length-1)/2)) / wizards.length * 0.6);
        var location = wizardOffset; // default
        for (locnum = 0; locnum < locations.length; locnum++){
          if ((locations[locnum].toLowerCase() == stateStr.toLowerCase()) 
            || (locations[locnum] == this.travellingState && (stateVelo > 15 || isMovingByProximity))
            || (locations[locnum] == this.lostState && stateStr == "not_home" && stateVelo <= 15 && !isMovingByProximity))
          {
            location = locnum + wizardOffset;
            break;
          }
        }
        //var location = locations.indexOf(wizards[num].location) + ((num-((wizards.length-1)/2)) / wizards.length * 0.75);
        location = location * Math.PI / locations.length * 2;
        // set targetstate
        this.targetstate.push({pos: location, length: radius*0.7, width: radius*0.1, wizard: wizards[num].name, colour: wizards[num].colour, textcolour: wizards[num].textcolour});
      }
      // update currentstate from targetstate
      if (!this.currentstate)
      {
        this.currentstate = [];
      }
      for (num = 0; num < wizards.length; num++){
        if (this.currentstate[num]){
          this.currentstate[num].pos = this.currentstate[num].pos + ((this.targetstate[num].pos - this.currentstate[num].pos) / 60); 
        } else {
          // default to 12 o'clock to start
          this.currentstate.push({pos: 0, length: this.targetstate[num].length, width: this.targetstate[num].width, wizard: this.targetstate[num].wizard, colour: this.targetstate[num].colour, textcolour: this.targetstate[num].textcolour});
        }
      }
      // draw currentstate
      for (num = 0; num < wizards.length; num++){
        this.drawHand(ctx, this.currentstate[num].pos, this.currentstate[num].length, this.currentstate[num].width, this.currentstate[num].wizard, this.currentstate[num].colour, this.currentstate[num].textcolour);
      }
  }

  drawHand(ctx, pos, length, width, wizard, colour, textcolour) {
    ctx.beginPath();
    ctx.lineWidth = width;
    if (colour) {
      ctx.fillStyle = colour;
    } else {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-color');
    }
    ctx.shadowColor = "#0008";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.moveTo(0,0);
    ctx.rotate(pos);
    ctx.quadraticCurveTo(width, -length*0.5, width, -length*0.75);
    ctx.quadraticCurveTo(width*0.2, -length*0.8, 0, -length);
    ctx.quadraticCurveTo(-width*0.2, -length*0.8, -width, -length*0.75);
    ctx.quadraticCurveTo(-width, -length*0.5, 0, 0);

    ctx.fill();

    ctx.font = width*this.fontScale + "px " + this.selectedFont;
    if (textcolour) {
      ctx.fillStyle = textcolour;
    } else {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-text-color');
    }
    ctx.translate(0, -length/2);
    ctx.rotate(Math.PI/2)
    if (pos < Math.PI && pos >= 0) 
        ctx.rotate(Math.PI);
    ctx.fillText(wizard, 0, 0);
    if (pos < Math.PI && pos >= 0) 
        ctx.rotate(-Math.PI);
    ctx.rotate(-Math.PI/2);
    ctx.translate(0, length/2);
    
    ctx.rotate(-pos);
  }

}

/* debounce the reaction to a card resize */
let resizeTimeout = false;
let resizeDelay = 500;

function debouncedOnResize(thisObject) {
  if (debugLogging) console.log(`${thisObject.config && thisObject.config.header ? "(" + thisObject.config.header + ") " : ""}debouncedOnResize triggering set hass`);
  /* trigger an update */
  thisObject.hass = thisObject._hass;
}

function createResizeObserver(thisObject) {
  return new ResizeObserver((entries) => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => debouncedOnResize(thisObject), resizeDelay);  });
}

customElements.define(CARDNAME, WizardClockCard);
