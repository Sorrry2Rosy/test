import PolygonEmitter from './emitter.js';   //粒子随机发射功能，用于区域添加返回坐标

//添加符号类
class AddSymbol {
    /**
       * Creates an instance of Roaming.
       * @param {*} viewer 需要传入
       * @example
       * 
   */
    constructor(viewer, options) {
        this.viewer = viewer;
        this.init(viewer);
        this.updateOptionsParams(options);
    }

    //初始化
    init(viewer) {
        this.checkInstanceCollection();

        this.emitter = new PolygonEmitter(); //区域粒子随机发射器，用于区域添加
        this.instanceCollection = null;
        this.allModelUrls = [];
        this.scaleRange = [1,1];
        this.rotateRange = [1,1];
    }


    /**
      * 更新可配置的内部参数
      * @param {object} options 配置项
      */
    updateOptionsParams(options) {
        if (!options) return;
        if (SuperMap3D.defined(options.scaleRange)) this.scaleRange = options.scaleRange;
        if (SuperMap3D.defined(options.rotateRange)) this.rotateRange = options.rotateRange;
    }

    // 随机大小和旋转
    updateScaleRange(scaleRange){
        this.scaleRange = scaleRange;
    };
    updateRotateRange(rotateRange){
        this.rotateRange = rotateRange;
    };

    // 从指定范围内获取随机数（小数）
    getRandomFromRange(range){
        if(!range) return 1; 
        if(range.length != 2) return 1; 
        let min = range[0];
        let max = range[1];
        return Math.random() * (max - min) + min;
    }

    // 检查instanceCollection是否存在，统一使用一个
    checkInstanceCollection(){
        if(!this.instanceCollection){
            viewer.scene.primitives._primitives.forEach(primitive => {
                if (primitive.customID && primitive.customID == "plantTree") {
                    this.instanceCollection = primitive;
                }
            })
        }
        if(!this.instanceCollection){
            this.instanceCollection = new SuperMap3D.S3MInstanceCollection(viewer.scene._context);
            this.instanceCollection.customID = 'plantTree';
            viewer.scene.primitives.add(this.instanceCollection);
        }
    }

    /**
      * 通过点方式添加符号
      * @param {string} modelUrl 模型路径
      * @param {object} position 添加位置坐标
      * @param {string} id       可选
      * 
      */
    addByPoint(modelUrl, position, instanceID) {
        if(!modelUrl || !position || !instanceID) return; // 他们三个任何一个不存在都不执行添加
        if(!instanceID.includes('addSymbol') || instanceID.split('-').length < 3) return; // 传入的instanceID不符合规范也不添加

        this.checkInstanceCollection();

        if (!SuperMap3D.defined(modelUrl) || !SuperMap3D.defined(position)) return;
        if (!this.allModelUrls.includes(modelUrl)) this.allModelUrls.push(modelUrl); //保存所有添加的路径

        let randomScaleNumber = this.getRandomFromRange(this.scaleRange);
        let randomScale = new SuperMap3D.Cartesian3(randomScaleNumber,randomScaleNumber,randomScaleNumber);
        let randomRotateNumber  = this.getRandomFromRange(this.rotateRange);
        let randomHpr = new SuperMap3D.HeadingPitchRoll(SuperMap3D.Math.toRadians(randomRotateNumber), 0, 0);

        let instanceOption = {
            id: instanceID,
            position: position,
            scale:randomScale,
            hpr:randomHpr
        }

        this.instanceCollection.add(modelUrl, instanceOption);

        return {
            url:modelUrl,
            options:instanceOption
        };
    }


    /**
      * 通过画线方式添加符号（沿线添加）
      * @param {string} modelUrl 模型路径
      * @param {array} line       添加画线坐标数组
      * @param {number} space       符号间间距
      * 
      */
    addByline(modelUrl, line, space, currentIndex) {
        this.checkInstanceCollection();

        if (!SuperMap3D.defined(modelUrl) || !SuperMap3D.defined(line)) return;
        let positions = [];
        for (let i = 1, j = line.length; i < j; i++) {
            let startPoint = line[i - 1];
            let endPoint = line[i];
            let d = SuperMap3D.Cartesian3.distance(startPoint, endPoint)
            let count = getCount(parseInt(d), space);
            for (let i = 1, j = count; i <= j; i++) {
                positions.push(
                    SuperMap3D.Cartesian3.lerp(
                        startPoint,
                        endPoint,
                        i / count,
                        new SuperMap3D.Cartesian3()
                    )
                );
            }
        }

        let polylineOptionList = []

        return viewer.scene.clampToHeightMostDetailed(positions)
            .then((Cartesians) => {
                let key = `polyline-${currentIndex}`;
                for (let i = 0, j = Cartesians.length; i <= j; i++) {
                    let instanceID = `${key}-${i}-addSymbol`;
                    let instanceOption = this.addByPoint(modelUrl, Cartesians[i], instanceID);
                    if(instanceOption) polylineOptionList.push(instanceOption);
                }
                polylineOptionList.push(currentIndex);
                return polylineOptionList;

            });

        //精度计算count插值
        function getCount(distance, space) {
            let space2 = SuperMap3D.defaultValue(space, 10);
            return parseInt(distance / space2) + 1
        }
    }

    /**
  * 通过画面方式添加符号（区域添加）
  * @param {string} modelUrl 模型路径
  * @param {array} positions       区域坐标数组
  * @param {number} count       区域间添加符号总数
  * 
  */
    addByFace(modelUrl, positions, count, currentIndex) {
        this.checkInstanceCollection();
        
        if (!SuperMap3D.defined(modelUrl) || !SuperMap3D.defined(positions) || positions.length < 3) return;
        this.emitter.initPolygonEmitter(positions);
        let polygonOptionList = []
        let key = `polygon-${currentIndex}`;
        for (let i = 0; i < count; i++) {
            let url = modelUrl.length == 1 ? modelUrl[0] : modelUrl[Math.floor((Math.random() * modelUrl.length))];
            let position = this.emitter.getOneRandomPosition();
            let instanceID = `${key}-${i}-addSymbol`;
            let instanceOption = this.addByPoint(url, position, instanceID);
            if(instanceOption) polygonOptionList.push(instanceOption);
        }

        polygonOptionList.push(currentIndex);

        return polygonOptionList;
    }

    /**
    * 销毁
    */
    destroy() {
        // this.allModelUrls.forEach((url) => this.instanceCollection.removeCollection(url)); // 通过URL删除所有实例对象
        this.allModelUrls.length = 0;
        this.viewer.scene.primitives.remove(this.instanceCollection); // 直接删除这个实例化图层
        this.instanceCollection = null;
        this.scaleRange = [1,1]
        this.rotateRange = [1,1]
    }
}

export default AddSymbol;
