class DragTool {
    constructor({ viewer, entityCanMoveNameString, treeData }) {
        this.viewer = viewer
        this.entityCanMoveNameString = entityCanMoveNameString
        this.treeData = treeData
        this.leftDownFlag = false
        this.isModelEditOpen = false
        this.model = null;//储存实体
        this.originColor = undefined;
        this.handler = new SuperMap3D.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        // this.
    }
    // 开始拖拽
    startDrag() {
        this.leftDownAction()
        this.mouseMoveAction()
        this.leftUpAction()
    }

    leftDownAction() {
        this.handler.setInputAction(e => {
            if (this.isModelEditOpen) return;
            let pick = this.viewer.scene.pick(e.position) || viewer.selectedEntity;
            if (!SuperMap3D.defined(pick)) return;
            if (pick.id && pick.primitive) {
                if (!pick.id.includes(this.entityCanMoveNameString)) return;
                this.model = pick.primitive;
                this.originColor = SuperMap3D.clone(this.model.color);
                this.model.updateColor(SuperMap3D.Color.RED); // // 选中颜色不明显，API没有相关设置，直接改变实例颜色当做选中
                this.leftDownFlag = true;
                this.viewer.scene.screenSpaceCameraController.enableRotate = false;//锁定相机
                //   viewer.selectedEntity = this.model; // 添加绿色指示框
            }
        }, SuperMap3D.ScreenSpaceEventType.LEFT_DOWN);
    }
    mouseMoveAction() {
        this.handler.setInputAction(e => {
            if (this.isModelEditOpen) return;
            if (this.leftDownFlag === true && this.model != null) {
                if (this.model.type == 'Instanced_Object') { // S3MInstance
                    let cartesian = viewer.scene.pickPosition(e.endPosition);
                    // this.model.updatePosition(cartesian); // 任意拖拽
                    if(!cartesian) return;
                    let cartographic = SuperMap3D.Cartographic.fromCartesian(cartesian, SuperMap3D.Ellipsoid.WGS84, new SuperMap3D.Cartographic());
                    let height;
                    if (viewer.scene.sampleHeightSupported) {
                        height = viewer.scene.sampleHeight(cartographic, [this.model]);
                    }
                    if (SuperMap3D.defined(height)) {
                        cartographic.height = height;
                    } else {
                        cartographic.height = 0.0;
                    }
                    let reCartesian = SuperMap3D.Cartographic.toCartesian(cartographic, SuperMap3D.Ellipsoid.WGS84, new SuperMap3D.Cartesian3());
                    this.model.updatePosition(reCartesian); // 贴S3M拖拽
                }
            }
        }, SuperMap3D.ScreenSpaceEventType.MOUSE_MOVE);
    }
    leftUpAction() {
        this.handler.setInputAction(e => {
            if (this.isModelEditOpen) return;
            if (this.leftDownFlag === true && this.model != null) {
                this.leftDownFlag = false;
                this.pointDraged = null;
                this.viewer.scene.screenSpaceCameraController.enableRotate = true;//解锁相机
                this.updateTreeDataPosition(this.model, ['position']); // 更新图层列表中的实例坐标

                if(this.model && this.originColor) this.model.updateColor(this.originColor); // 恢复之前选中实体的颜色
                this.model = null; // 拖拽结束后及时释放所选实体，避免出现对象暂留导致清除效果不对
                // this.rightClickAction(); // 开启：点击右键即可编辑模型
            }
        }, SuperMap3D.ScreenSpaceEventType.LEFT_UP);
    }

    // 有点问题this.model，不拖拽的话还是之前那一个
    rightClickAction() {
        this.handler.setInputAction(e => {
            if(!this.model) return;
            if(this.isModelEditOpen){
                this.closeModelEditor();
                this.isModelEditOpen = false;
            }else{
                this.openModelEditor(this.model);
                this.isModelEditOpen = true;
            }
        }, SuperMap3D.ScreenSpaceEventType.RIGHT_CLICK);
    }

    // 添加模型编辑器
    openModelEditor(instance) {
        if (!SuperMap3D.defined(instance)) return;
        // instance必须是Entity或者S3Mintance
        if (!((instance instanceof SuperMap3D.Entity) || (instance instanceof SuperMap3D.S3MInstance))) return;
        this.model = instance;
        if (this.modelEditor) {
            this.modelEditor.setEditObject(this.model);
            this.modelEditor.activate();
            return;
        }
        this.modelEditor = new SuperMap3D.ModelEditor({
            model: this.model,
            scene: this.viewer.scene,
            // lineWidthScale: 20, // 放大轴方便操作，只有第一次设置后操作管用
            axesShow: {
                translation: true,
                rotation: true,
                scale: true
            }
        });
        this.modelEditor.changedEvt.addEventListener((param) => {
            // console.log('模型编辑param:',param);
            this.updateTreeDataPosition(this.model, ['position', 'scale', 'hpr']);
        })

        this.modelEditor.activate();
    }

    // 关闭模型编辑框
    closeModelEditor() {
        if (this.modelEditor) this.modelEditor.deactivate();
    }

    // 将指定type的属性从instance传给target
    typesToOptions(target, instance, types) {
        if (types.length === 1) {
            const type = types[0];
            target.options[type] = instance[type];
        } else if (types.length > 1) {
            for (let index = 0; index < types.length; index++) {
                const type = types[index];
                target.options[type] = instance[type];
            }
        }
    }

    // 基于instanceID更新图层树中指定option的属性
    updateTreeDataPosition(instance, types) {
        if(!instance) return;
        if(!instance.id) return;
        if(!this.treeData) return;
        let treeDataList = this.treeData[0].children;
        let instanceID = instance.id;
        let idList = instanceID.split('-'); // instance中的ID里面可以直接生成其在图层列表中对应的parentKey，因为他们都是基于currentIndex生成的
        let type = idList[0];
        let target = undefined;

        if (type == 'point') { // 点集合
            target = treeDataList[0].children.find((child) => {
                if (child.options && child.options.id) {
                    return instanceID === child.options.id;
                }
            })
            if (target) this.typesToOptions(target, instance, types);
        } else if (type == 'polyline') { // 线集合
            let parentKey = `2-${idList[1]}`;
            treeDataList[1].children.forEach((node) => {
                if (node.key == parentKey) {
                    target = node.children.find((child) => {
                        if (child.options && child.options.id) {
                            return instanceID === child.options.id;
                        }
                    })
                    if (target) this.typesToOptions(target, instance, types);
                }
            })
        } else if (type == 'polygon') { // 面集合
            let parentKey = `3-${idList[1]}`;
            treeDataList[2].children.forEach((node) => {
                if (node.key == parentKey) {
                    target = node.children.find((child) => {
                        if (child.options && child.options.id) {
                            return instanceID === child.options.id;
                        }
                    })
                    if (target) this.typesToOptions(target, instance, types);
                }
            })
        }

        return target;
    }

    //清除鼠标事件
    cancelDrag() {
        this.handler.removeInputAction(SuperMap3D.ScreenSpaceEventType.LEFT_DOWN);
        this.handler.removeInputAction(SuperMap3D.ScreenSpaceEventType.LEFT_UP);
        this.handler.removeInputAction(SuperMap3D.ScreenSpaceEventType.MOUSE_MOVE);
        this.handler.removeInputAction(SuperMap3D.ScreenSpaceEventType.RIGHT_CLICK);

        if (this.modelEditor) this.modelEditor.deactivate();
        if (this.modelEditor) this.modelEditor.destroy();
        this.modelEditor = null;
    }
}

export default DragTool;